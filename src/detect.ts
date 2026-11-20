export type Axis = "x" | "y";

export interface AxisResult {
  cell: number;
  offset: number;
}

const MAX_CELL = 256;

export function edgeSignal(data: Uint8ClampedArray, w: number, h: number, axis: Axis): Float64Array {
  if (axis === "x") {
    const e = new Float64Array(w);
    for (let x = 1; x < w; x++) {
      let sum = 0;
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        const j = i - 4;
        sum += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      }
      e[x] = sum;
    }
    return e;
  }

  const e = new Float64Array(h);
  for (let y = 1; y < h; y++) {
    let sum = 0;
    const row = y * w;
    const prev = (y - 1) * w;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      const j = (prev + x) * 4;
      sum += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
    }
    e[y] = sum;
  }
  return e;
}

function interp(a: Float64Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0 || i >= a.length) return 0;
  if (i + 1 >= a.length) return a[i];
  const f = pos - i;
  return a[i] * (1 - f) + a[i + 1] * f;
}

function autocorrelation(e: Float64Array, len: number, maxLag: number): Float64Array {
  let mean = 0;
  for (let i = 0; i < len; i++) mean += e[i];
  mean /= len;

  const c = new Float64Array(len);
  for (let i = 0; i < len; i++) c[i] = e[i] - mean;

  const a = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let x = 0; x + lag < len; x++) sum += c[x] * c[x + lag];
    a[lag] = sum;
  }
  return a;
}

export function detectAxis(e: Float64Array, len: number, minCell = 2): AxisResult {
  const maxCell = Math.min(MAX_CELL, Math.floor(len / 2));
  if (maxCell < minCell) return { cell: Math.max(1, len), offset: 0 };

  const maxLag = Math.min(maxCell * 6, len - 1);
  const acf = autocorrelation(e, len, maxLag);

  let bestScore = -Infinity;
  let bestCell = minCell;
  for (let p = minCell; p <= maxCell; p += 0.25) {
    let sum = 0;
    let n = 0;
    for (let k = 1; k * p <= maxLag; k++) {
      sum += interp(acf, k * p);
      n++;
    }
    if (n === 0) continue;
    const score = sum / Math.sqrt(n);
    if (score > bestScore) {
      bestScore = score;
      bestCell = p;
    }
  }

  let bestOffset = 0;
  let bestPhase = -Infinity;
  for (let ph = 0; ph < bestCell; ph += 0.25) {
    let sum = 0;
    for (let pos = ph; pos < len; pos += bestCell) sum += interp(e, pos);
    if (sum > bestPhase) {
      bestPhase = sum;
      bestOffset = ph;
    }
  }

  return { cell: bestCell, offset: bestOffset };
}
