import { packRGB } from "./color";

export type SampleMode = "average" | "dominant" | "center";

export interface Grid {
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
}

export interface Boundaries {
  xs: number[];
  ys: number[];
}

export interface Sampled {
  cols: number;
  rows: number;
  data: Uint8Array;
}

const INSET = 0.18;
const ALPHA_THRESHOLD = 128;
const KEEP_FLOOR = 8;

export function gridDims(g: Grid, w: number, h: number): { cols: number; rows: number } {
  const cols = Math.max(0, Math.floor((w - g.offsetX + 1e-6) / g.cellW));
  const rows = Math.max(0, Math.floor((h - g.offsetY + 1e-6) / g.cellH));
  return { cols, rows };
}

export function buildBoundaries(g: Grid, w: number, h: number): Boundaries {
  const { cols, rows } = gridDims(g, w, h);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= cols; i++) xs.push(g.offsetX + i * g.cellW);
  for (let j = 0; j <= rows; j++) ys.push(g.offsetY + j * g.cellH);
  return { xs, ys };
}

export function refineBoundaries(
  bounds: number[],
  edge: Float64Array,
  cell: number,
  frac: number,
  limit: number,
): void {
  const win = Math.max(1, Math.round(cell * frac));
  const minGap = Math.max(1, cell * 0.4);
  for (let i = 0; i < bounds.length; i++) {
    const center = Math.round(bounds[i]);
    let lo = Math.max(1, center - win);
    const hi = Math.min(limit - 1, center + win);
    if (i > 0) lo = Math.max(lo, Math.round(bounds[i - 1] + minGap));

    let bestX = center;
    let bestScore = -Infinity;
    for (let x = lo; x <= hi; x++) {
      const bias = 1 - 0.6 * (Math.abs(x - center) / (win + 1));
      const score = edge[x] * bias;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
    if (i > 0 && bestX <= bounds[i - 1]) bestX = bounds[i - 1] + 1;
    bounds[i] = bestX;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function medianInto(src: Float64Array, len: number, scratch: Float64Array): number {
  for (let i = 0; i < len; i++) scratch[i] = src[i];
  const view = scratch.subarray(0, len);
  view.sort();
  const mid = len >> 1;
  return len % 2 ? view[mid] : (view[mid - 1] + view[mid]) / 2;
}

export function sampleBoundaries(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  b: Boundaries,
  mode: SampleMode,
): Sampled {
  const cols = Math.max(0, b.xs.length - 1);
  const rows = Math.max(0, b.ys.length - 1);
  const out = new Uint8Array(cols * rows * 4);

  let maxW = 1;
  let maxH = 1;
  for (let i = 0; i < cols; i++) maxW = Math.max(maxW, Math.ceil(b.xs[i + 1] - b.xs[i]));
  for (let j = 0; j < rows; j++) maxH = Math.max(maxH, Math.ceil(b.ys[j + 1] - b.ys[j]));
  const capacity = Math.max(1, maxW * maxH);
  const rs = new Float64Array(capacity);
  const gs = new Float64Array(capacity);
  const bs = new Float64Array(capacity);
  const dist = new Float64Array(capacity);
  const scratch = new Float64Array(capacity);

  for (let j = 0; j < rows; j++) {
    const topF = b.ys[j];
    const botF = b.ys[j + 1];
    const cellH = botF - topF;
    const y0 = clampInt(Math.round(topF + cellH * INSET), 0, h - 1);
    const y1 = clampInt(Math.round(botF - cellH * INSET), y0 + 1, h);
    const cy = clampInt(Math.round((topF + botF) / 2), 0, h - 1);

    for (let i = 0; i < cols; i++) {
      const leftF = b.xs[i];
      const rightF = b.xs[i + 1];
      const cellW = rightF - leftF;
      const x0 = clampInt(Math.round(leftF + cellW * INSET), 0, w - 1);
      const x1 = clampInt(Math.round(rightF - cellW * INSET), x0 + 1, w);
      const cx = clampInt(Math.round((leftF + rightF) / 2), 0, w - 1);

      let r = 0;
      let gr = 0;
      let bl = 0;
      let a = 0;

      if (mode === "center") {
        const idx = (cy * w + cx) * 4;
        if (data[idx + 3] >= ALPHA_THRESHOLD) {
          r = data[idx];
          gr = data[idx + 1];
          bl = data[idx + 2];
          a = 255;
        }
      } else if (mode === "dominant") {
        const counts = new Map<number, number>();
        let bestKey = 0;
        let bestCount = 0;
        let opaque = 0;
        let total = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * w + x) * 4;
            total++;
            if (data[idx + 3] < ALPHA_THRESHOLD) continue;
            opaque++;
            const key = packRGB(data[idx], data[idx + 1], data[idx + 2]);
            const next = (counts.get(key) ?? 0) + 1;
            counts.set(key, next);
            if (next > bestCount) {
              bestCount = next;
              bestKey = key;
            }
          }
        }
        if (opaque * 2 >= total) {
          r = (bestKey >> 16) & 255;
          gr = (bestKey >> 8) & 255;
          bl = bestKey & 255;
          a = 255;
        }
      } else {
        let m = 0;
        let total = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * w + x) * 4;
            total++;
            if (data[idx + 3] < ALPHA_THRESHOLD) continue;
            rs[m] = data[idx];
            gs[m] = data[idx + 1];
            bs[m] = data[idx + 2];
            m++;
          }
        }
        if (m > 0 && m * 2 >= total) {
          const mr = medianInto(rs, m, scratch);
          const mg = medianInto(gs, m, scratch);
          const mb = medianInto(bs, m, scratch);
          for (let p = 0; p < m; p++) {
            const dr = rs[p] - mr;
            const dg = gs[p] - mg;
            const db = bs[p] - mb;
            dist[p] = Math.sqrt(dr * dr + dg * dg + db * db);
          }
          const threshold = Math.max(KEEP_FLOOR, 2 * medianInto(dist, m, scratch));
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let kept = 0;
          for (let p = 0; p < m; p++) {
            if (dist[p] <= threshold) {
              sr += rs[p];
              sg += gs[p];
              sb += bs[p];
              kept++;
            }
          }
          if (kept > 0) {
            r = Math.round(sr / kept);
            gr = Math.round(sg / kept);
            bl = Math.round(sb / kept);
          } else {
            r = Math.round(mr);
            gr = Math.round(mg);
            bl = Math.round(mb);
          }
          a = 255;
        }
      }

      const o = (j * cols + i) * 4;
      out[o] = r;
      out[o + 1] = gr;
      out[o + 2] = bl;
      out[o + 3] = a;
    }
  }

  return { cols, rows, data: out };
}
