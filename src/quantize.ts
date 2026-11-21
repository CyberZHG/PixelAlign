import { oklabDist2, packRGB, rgbToOklab, unpackRGB, type Lab } from "./color";

export interface ColorCount {
  key: number;
  r: number;
  g: number;
  b: number;
  count: number;
}

export function histogram(buf: Uint8Array): ColorCount[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] < 128) continue;
    const key = packRGB(buf[i], buf[i + 1], buf[i + 2]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: ColorCount[] = [];
  counts.forEach((count, key) => {
    const [r, g, b] = unpackRGB(key);
    result.push({ key, r, g, b, count });
  });
  result.sort((a, b) => b.count - a.count || a.key - b.key);
  return result;
}

export interface Reduction {
  kept: ColorCount[];
  map: Map<number, number>;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A single dominant color (e.g. a large flat background) otherwise hoards
// palette slots and pulls minority colors into itself, tinting the whole
// image toward it. Compressing the per-color weight with an exponent < 1
// keeps the preference for common colors while taming that dominance.
// 1 = plain pixel-count weighting, 0 = every unique color counts equally.
const WEIGHT_GAMMA = 0.5;

export function reduceColors(
  hist: ColorCount[],
  keepCount: number,
  onProgress?: (fraction: number) => void,
  gamma: number = WEIGHT_GAMMA,
): Reduction {
  const n = hist.length;
  const k = Math.max(1, Math.min(keepCount, n));
  const maxIter = 24;
  const labs: Lab[] = hist.map((c) => rgbToOklab(c.r, c.g, c.b));
  const weight = hist.map((c) => Math.pow(c.count, gamma));
  const report = onProgress ?? (() => {});
  const initStep = Math.max(1, Math.floor(k / 20));

  const rand = mulberry32(0x9e3779b9);
  const centers: Lab[] = [labs[0]];
  const nearest = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = oklabDist2(labs[i], last);
      if (d < nearest[i]) nearest[i] = d;
      total += nearest[i] * weight[i];
    }
    let pick = rand() * total;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      pick -= nearest[i] * weight[i];
      chosen = i;
      if (pick <= 0) break;
    }
    centers.push(labs[chosen]);
    if (centers.length % initStep === 0) report((0.4 * centers.length) / k);
  }

  const assign = new Int32Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = oklabDist2(labs[i], centers[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }

    const acc = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const a = assign[i];
      const w = weight[i];
      acc[a][0] += labs[i][0] * w;
      acc[a][1] += labs[i][1] * w;
      acc[a][2] += labs[i][2] * w;
      acc[a][3] += w;
    }
    for (let c = 0; c < k; c++) {
      if (acc[c][3] > 0) centers[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
    }
    report(0.4 + (0.6 * (iter + 1)) / maxIter);
    if (!changed && iter > 0) break;
  }

  const repIndex = new Int32Array(k).fill(-1);
  const repDist = new Float64Array(k).fill(Infinity);
  const clusterWeight = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const c = assign[i];
    clusterWeight[c] += hist[i].count;
    const d = oklabDist2(labs[i], centers[c]);
    if (d < repDist[c]) {
      repDist[c] = d;
      repIndex[c] = i;
    }
  }

  const clusterKey: number[] = new Array(k);
  for (let c = 0; c < k; c++) clusterKey[c] = hist[repIndex[c] >= 0 ? repIndex[c] : 0].key;

  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) map.set(hist[i].key, clusterKey[assign[i]]);

  const kept: ColorCount[] = [];
  for (let c = 0; c < k; c++) {
    if (repIndex[c] < 0) continue;
    const col = hist[repIndex[c]];
    kept.push({ key: col.key, r: col.r, g: col.g, b: col.b, count: Math.round(clusterWeight[c]) });
  }
  kept.sort((a, b) => b.count - a.count);

  return { kept, map };
}

export function applyMap(buf: Uint8Array, map: Map<number, number>): Uint8Array {
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] < 128) continue;
    const key = packRGB(buf[i], buf[i + 1], buf[i + 2]);
    const mapped = map.get(key) ?? key;
    out[i] = (mapped >> 16) & 255;
    out[i + 1] = (mapped >> 8) & 255;
    out[i + 2] = mapped & 255;
    out[i + 3] = 255;
  }
  return out;
}
