import "./style.css";
import { toHex } from "./color";
import { detectAxis, edgeSignal } from "./detect";
import { buildBoundaries, refineBoundaries, sampleBoundaries, type Grid, type SampleMode } from "./sample";
import { applyMap, histogram, type ColorCount } from "./quantize";
import { applyLang, detectLang, saveLang, t, type Lang } from "./i18n";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("fileInput");
const dropZone = $<HTMLLabelElement>("dropZone");
const btnAuto = $<HTMLButtonElement>("btnAuto");
const inCellW = $<HTMLInputElement>("inCellW");
const inCellH = $<HTMLInputElement>("inCellH");
const inOffX = $<HTMLInputElement>("inOffX");
const inOffY = $<HTMLInputElement>("inOffY");
const selSample = $<HTMLSelectElement>("selSample");
const chkGrid = $<HTMLInputElement>("chkGrid");
const btnMeasure = $<HTMLButtonElement>("btnMeasure");
const chkRefine = $<HTMLInputElement>("chkRefine");
const rangeRefine = $<HTMLInputElement>("rangeRefine");
const refineRangeWrap = $<HTMLLabelElement>("refineRangeWrap");
const refineValue = $<HTMLSpanElement>("refineValue");
const rangeColors = $<HTMLInputElement>("rangeColors");
const numColors = $<HTMLInputElement>("numColors");
const rangeBalance = $<HTMLInputElement>("rangeBalance");
const balanceValue = $<HTMLSpanElement>("balanceValue");
const paletteEl = $<HTMLDivElement>("palette");
const progressWrap = $<HTMLDivElement>("progressWrap");
const progressBar = $<HTMLDivElement>("progressBar");
const selExport = $<HTMLSelectElement>("selExport");
const btnDownload = $<HTMLButtonElement>("btnDownload");
const canvasOrig = $<HTMLCanvasElement>("canvasOrig");
const gridOverlay = $<HTMLCanvasElement>("gridOverlay");
const canvasPreview = $<HTMLCanvasElement>("canvasPreview");
const emptyOrig = $<HTMLParagraphElement>("emptyOrig");
const stats = $<HTMLSpanElement>("stats");
const hintMeasure = $<HTMLSpanElement>("hintMeasure");
const langToggle = $<HTMLButtonElement>("langToggle");
const themeToggle = $<HTMLButtonElement>("themeToggle");
const iconSun = $<HTMLElement>("iconSun");
const iconMoon = $<HTMLElement>("iconMoon");

const octx = canvasOrig.getContext("2d") as CanvasRenderingContext2D;
const gctx = gridOverlay.getContext("2d") as CanvasRenderingContext2D;
const pctx = canvasPreview.getContext("2d") as CanvasRenderingContext2D;

interface Source {
  image: HTMLImageElement;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  edgeX: Float64Array;
  edgeY: Float64Array;
}

let lang: Lang = detectLang();
let source: Source | null = null;
let grid: Grid = { cellW: 16, cellH: 16, offsetX: 0, offsetY: 0 };
let sampleMode: SampleMode = "average";
let refine = false;
let refineFrac = 0.3;
let curXs: number[] = [];
let curYs: number[] = [];
let hist: ColorCount[] = [];
let palette: ColorCount[] = [];
let keepColors = 2;
// 0 = weight by raw pixel count, 1 = every color counts equally. Higher values
// stop a dominant color from hoarding palette slots and tinting the result.
let balance = 0.5;
let baseBuf: Uint8Array = new Uint8Array(0);
let finalBuf: Uint8Array = new Uint8Array(0);
let cols = 0;
let rows = 0;

let measuring = false;
let measurePoints: { x: number; y: number }[] = [];
let dragging = false;
let dragStart = { x: 0, y: 0 };
let dragOffset = { x: 0, y: 0 };

function setLang(next: Lang): void {
  lang = next;
  saveLang(next);
  applyLang(lang);
  langToggle.textContent = lang === "en" ? "中文" : "EN";
  renderStats();
}

function syncTheme(dark: boolean): void {
  iconSun.classList.toggle("hidden", dark);
  iconMoon.classList.toggle("hidden", !dark);
}

themeToggle.addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  syncTheme(dark);
  drawOriginal();
});

langToggle.addEventListener("click", () => setLang(lang === "en" ? "zh" : "en"));

function enableControls(on: boolean): void {
  [
    inCellW,
    inCellH,
    inOffX,
    inOffY,
    btnAuto,
    btnMeasure,
    chkRefine,
    rangeRefine,
    selSample,
    rangeColors,
    numColors,
    rangeBalance,
    btnDownload,
  ].forEach((el) => {
    (el as HTMLInputElement).disabled = !on;
  });
  document.querySelectorAll<HTMLButtonElement>(".num-step").forEach((b) => (b.disabled = !on));
}

function stepInput(input: HTMLInputElement, dir: number): void {
  if (input.disabled) return;
  const step = parseFloat(input.step) || 1;
  const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
  const max = input.max !== "" ? parseFloat(input.max) : Infinity;
  let value = (parseFloat(input.value) || 0) + dir * step;
  value = Math.min(max, Math.max(min, value));
  input.value = (Math.round(value * 100) / 100).toString();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function enhanceNumber(input: HTMLInputElement, wrapClass = ""): void {
  const wrap = document.createElement("div");
  wrap.className = `relative ${wrapClass}`.trim();
  input.replaceWith(wrap);
  wrap.appendChild(input);
  input.classList.add("pr-6", "w-full");

  const chevron = (d: string) =>
    `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" /></svg>`;

  const column = document.createElement("div");
  column.className = "absolute right-0 top-0 flex h-full w-5 flex-col overflow-hidden rounded-r-md";
  column.style.borderLeft = "1px solid var(--border)";

  const up = document.createElement("button");
  up.type = "button";
  up.disabled = input.disabled;
  up.className = "num-step flex flex-1 items-center justify-center";
  up.innerHTML = chevron("M18 15l-6-6-6 6");
  up.addEventListener("click", () => stepInput(input, 1));

  const down = document.createElement("button");
  down.type = "button";
  down.disabled = input.disabled;
  down.className = "num-step flex flex-1 items-center justify-center";
  down.style.borderTop = "1px solid var(--border)";
  down.innerHTML = chevron("M6 9l6 6 6-6");
  down.addEventListener("click", () => stepInput(input, -1));

  column.append(up, down);
  wrap.appendChild(column);
}

function loadImage(file: File): void {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    const buffer = document.createElement("canvas");
    buffer.width = image.naturalWidth;
    buffer.height = image.naturalHeight;
    const bctx = buffer.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    bctx.drawImage(image, 0, 0);
    const data = bctx.getImageData(0, 0, buffer.width, buffer.height).data;
    const edgeX = edgeSignal(data, buffer.width, buffer.height, "x");
    const edgeY = edgeSignal(data, buffer.width, buffer.height, "y");
    source = { image, width: buffer.width, height: buffer.height, data, edgeX, edgeY };

    canvasOrig.style.display = "";
    canvasPreview.style.display = "";
    emptyOrig.style.display = "none";
    enableControls(true);
    resetView();
    autoDetect();
  };
  image.src = url;
}

function autoDetect(): void {
  if (!source) return;
  const rx = detectAxis(source.edgeX, source.width);
  const ry = detectAxis(source.edgeY, source.height);
  grid = { cellW: rx.cell, cellH: ry.cell, offsetX: rx.offset, offsetY: ry.offset };
  syncInputs();
  updateGrid();
  resample(true);
}

function syncInputs(): void {
  inCellW.value = fmt(grid.cellW);
  inCellH.value = fmt(grid.cellH);
  inOffX.value = fmt(grid.offsetX);
  inOffY.value = fmt(grid.offsetY);
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function readInputs(): void {
  grid.cellW = Math.max(1, parseFloat(inCellW.value) || 1);
  grid.cellH = Math.max(1, parseFloat(inCellH.value) || 1);
  grid.offsetX = parseFloat(inOffX.value) || 0;
  grid.offsetY = parseFloat(inOffY.value) || 0;
}

function updateGrid(): void {
  if (!source) return;
  const b = buildBoundaries(grid, source.width, source.height);
  if (refine) {
    refineBoundaries(b.xs, source.edgeX, grid.cellW, refineFrac, source.width);
    refineBoundaries(b.ys, source.edgeY, grid.cellH, refineFrac, source.height);
  }
  curXs = b.xs;
  curYs = b.ys;
  cols = Math.max(0, curXs.length - 1);
  rows = Math.max(0, curYs.length - 1);
  drawOriginal();
}

let resampleTimer = 0;
function scheduleResample(): void {
  window.clearTimeout(resampleTimer);
  resampleTimer = window.setTimeout(() => resample(false), 90);
}

function resample(resetColors: boolean): void {
  if (!source) return;
  const sampled = sampleBoundaries(source.data, source.width, source.height, { xs: curXs, ys: curYs }, sampleMode);
  cols = sampled.cols;
  rows = sampled.rows;
  baseBuf = sampled.data;
  hist = histogram(baseBuf);

  const max = Math.max(2, hist.length);
  rangeColors.min = "2";
  rangeColors.max = max.toString();
  numColors.max = max.toString();
  if (resetColors) keepColors = max;
  keepColors = Math.min(Math.max(2, keepColors), max);
  rangeColors.value = keepColors.toString();
  numColors.value = keepColors.toString();

  applyReduction();
}

const reducer = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let reduceId = 0;

reducer.onmessage = (e: MessageEvent) => {
  const msg = e.data as { id: number; type: string; fraction?: number; kept?: ColorCount[]; map?: Map<number, number> };
  if (msg.id !== reduceId) return;
  if (msg.type === "progress") {
    progressBar.style.width = `${Math.round((msg.fraction ?? 0) * 100)}%`;
    return;
  }
  progressWrap.classList.add("hidden");
  palette = msg.kept ?? [];
  finalBuf = applyMap(baseBuf, msg.map ?? new Map());
  renderPreview();
  renderPalette();
  renderStats();
};

function applyReduction(): void {
  reduceId++;
  if (keepColors >= hist.length) {
    progressWrap.classList.add("hidden");
    palette = hist;
    finalBuf = baseBuf;
    renderPreview();
    renderPalette();
    renderStats();
    return;
  }
  progressBar.style.width = "0%";
  progressWrap.classList.remove("hidden");
  reducer.postMessage({ id: reduceId, hist, keepCount: keepColors, gamma: 1 - balance });
}

function uniformEdges(cell: number, n: number): Int32Array {
  const edges = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) edges[i] = Math.round(i * cell);
  return edges;
}

function renderPreview(): void {
  const xe = uniformEdges(grid.cellW, cols);
  const ye = uniformEdges(grid.cellH, rows);
  canvasPreview.width = Math.max(1, xe[cols]);
  canvasPreview.height = Math.max(1, ye[rows]);
  pctx.clearRect(0, 0, canvasPreview.width, canvasPreview.height);
  if (cols === 0 || rows === 0) return;

  for (let j = 0; j < rows; j++) {
    const y = ye[j];
    const ch = ye[j + 1] - ye[j];
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      if (finalBuf[o + 3] < 128) continue;
      pctx.fillStyle = `rgb(${finalBuf[o]},${finalBuf[o + 1]},${finalBuf[o + 2]})`;
      pctx.fillRect(xe[i], y, xe[i + 1] - xe[i], ch);
    }
  }
}

function renderPalette(): void {
  paletteEl.replaceChildren();
  for (const c of palette) {
    const swatch = document.createElement("div");
    swatch.className = "h-6 w-6 rounded";
    swatch.style.background = toHex(c.r, c.g, c.b);
    swatch.style.border = "1px solid var(--border)";
    swatch.title = `${toHex(c.r, c.g, c.b)} (${c.count})`;
    paletteEl.appendChild(swatch);
  }
}

function renderStats(): void {
  if (!source) {
    stats.textContent = "";
    return;
  }
  const used = palette.length || hist.length;
  stats.textContent = `${cols}x${rows} ${t(lang, "cellsUnit")} · ${hist.length} ${t(lang, "colorsUnit")} → ${t(lang, "reducedTo")} ${used}`;
}

function drawOriginal(): void {
  if (!source) return;
  canvasOrig.width = source.width;
  canvasOrig.height = source.height;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(source.image, 0, 0);

  if (measurePoints.length > 0) {
    const r = Math.max(2, source.width / 160);
    octx.fillStyle = "#f59e0b";
    for (const p of measurePoints) {
      octx.beginPath();
      octx.arc(p.x, p.y, r, 0, Math.PI * 2);
      octx.fill();
    }
  }

  drawGridOverlay();
}

function drawGridOverlay(): void {
  const parent = gridOverlay.parentElement as HTMLElement;
  const cw = parent.clientWidth;
  const ch = parent.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (gridOverlay.width !== Math.round(cw * dpr)) gridOverlay.width = Math.round(cw * dpr);
  if (gridOverlay.height !== Math.round(ch * dpr)) gridOverlay.height = Math.round(ch * dpr);

  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gctx.clearRect(0, 0, cw, ch);
  if (!source || !chkGrid.checked) return;

  const r = canvasOrig.getBoundingClientRect();
  const c = parent.getBoundingClientRect();
  const ox = r.left - c.left;
  const oy = r.top - c.top;
  const sx = r.width / canvasOrig.width;
  const sy = r.height / canvasOrig.height;

  gctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6366f1";
  gctx.globalAlpha = 0.85;
  gctx.lineWidth = 0.75;
  gctx.beginPath();
  for (const x of curXs) {
    const px = ox + x * sx;
    gctx.moveTo(px, oy);
    gctx.lineTo(px, oy + r.height);
  }
  for (const y of curYs) {
    const py = oy + y * sy;
    gctx.moveTo(ox, py);
    gctx.lineTo(ox + r.width, py);
  }
  gctx.stroke();
  gctx.globalAlpha = 1;
}

function toNatural(ev: PointerEvent): { x: number; y: number } {
  const rect = canvasOrig.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * canvasOrig.width,
    y: ((ev.clientY - rect.top) / rect.height) * canvasOrig.height,
  };
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function setMeasuring(on: boolean): void {
  measuring = on;
  measurePoints = [];
  hintMeasure.classList.toggle("hidden", !on);
  btnMeasure.classList.toggle("btn-accent", on);
  drawOriginal();
}

canvasOrig.addEventListener("pointerdown", (ev) => {
  if (!source) return;
  canvasOrig.setPointerCapture(ev.pointerId);
  const p = toNatural(ev);

  if (measuring) {
    measurePoints.push(p);
    if (measurePoints.length === 2) {
      const [a, b] = measurePoints;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx >= dy && dx >= 1) {
        grid.cellW = dx;
        grid.offsetX = wrap(Math.min(a.x, b.x), grid.cellW);
      } else if (dy >= 1) {
        grid.cellH = dy;
        grid.offsetY = wrap(Math.min(a.y, b.y), grid.cellH);
      }
      setMeasuring(false);
      syncInputs();
      updateGrid();
      resample(false);
    } else {
      drawOriginal();
    }
    return;
  }

  dragging = true;
  dragStart = p;
  dragOffset = { x: grid.offsetX, y: grid.offsetY };
});

canvasOrig.addEventListener("pointermove", (ev) => {
  if (!dragging || !source) return;
  const p = toNatural(ev);
  grid.offsetX = wrap(dragOffset.x + (p.x - dragStart.x), grid.cellW);
  grid.offsetY = wrap(dragOffset.y + (p.y - dragStart.y), grid.cellH);
  syncInputs();
  updateGrid();
  scheduleResample();
});

canvasOrig.addEventListener("pointerup", () => {
  dragging = false;
});

const view = { scale: 1, tx: 0, ty: 0 };
canvasOrig.style.transformOrigin = "0 0";
canvasPreview.style.transformOrigin = "0 0";

function applyView(): void {
  const transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  canvasOrig.style.transform = transform;
  canvasPreview.style.transform = transform;
  drawGridOverlay();
}

function resetView(): void {
  view.scale = 1;
  view.tx = 0;
  view.ty = 0;
  applyView();
}

function clampPan(target: HTMLCanvasElement): void {
  const rect = target.getBoundingClientRect();
  const baseW = rect.width / view.scale;
  const baseH = rect.height / view.scale;
  const pad = 48;
  view.tx = Math.max(Math.min(0, baseW - rect.width) - pad, Math.min(pad, view.tx));
  view.ty = Math.max(Math.min(0, baseH - rect.height) - pad, Math.min(pad, view.ty));
}

function onWheel(ev: WheelEvent): void {
  if (!source) return;
  const target = ev.currentTarget as HTMLCanvasElement;
  if (ev.ctrlKey) {
    ev.preventDefault();
    const rect = target.getBoundingClientRect();
    const lx = (ev.clientX - rect.left) / view.scale;
    const ly = (ev.clientY - rect.top) / view.scale;
    const next = Math.min(24, Math.max(1, view.scale * Math.exp(-ev.deltaY * 0.01)));
    view.tx += (view.scale - next) * lx;
    view.ty += (view.scale - next) * ly;
    view.scale = next;
    if (next === 1) {
      view.tx = 0;
      view.ty = 0;
    }
  } else {
    if (view.scale <= 1) return;
    ev.preventDefault();
    view.tx -= ev.deltaX;
    view.ty -= ev.deltaY;
  }
  clampPan(target);
  applyView();
}

canvasOrig.addEventListener("wheel", onWheel, { passive: false });
canvasPreview.addEventListener("wheel", onWheel, { passive: false });

let panning = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };
canvasPreview.addEventListener("pointerdown", (ev) => {
  if (view.scale <= 1) return;
  panning = true;
  canvasPreview.setPointerCapture(ev.pointerId);
  canvasPreview.style.cursor = "grabbing";
  panStart = { x: ev.clientX, y: ev.clientY };
  panOrigin = { x: view.tx, y: view.ty };
});
canvasPreview.addEventListener("pointermove", (ev) => {
  if (!panning) return;
  view.tx = panOrigin.x + (ev.clientX - panStart.x);
  view.ty = panOrigin.y + (ev.clientY - panStart.y);
  clampPan(canvasPreview);
  applyView();
});
canvasPreview.addEventListener("pointerup", () => {
  panning = false;
  canvasPreview.style.cursor = "grab";
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadImage(file);
});

dropZone.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  dropZone.style.borderColor = "var(--accent)";
});
dropZone.addEventListener("dragleave", () => {
  dropZone.style.borderColor = "var(--border)";
});
dropZone.addEventListener("drop", (ev) => {
  ev.preventDefault();
  dropZone.style.borderColor = "var(--border)";
  const file = ev.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) loadImage(file);
});

[inCellW, inCellH, inOffX, inOffY].forEach((el) =>
  el.addEventListener("input", () => {
    readInputs();
    updateGrid();
    scheduleResample();
  }),
);

btnAuto.addEventListener("click", autoDetect);

selSample.addEventListener("change", () => {
  sampleMode = selSample.value as SampleMode;
  resample(false);
});

chkGrid.addEventListener("change", drawGridOverlay);

btnMeasure.addEventListener("click", () => setMeasuring(!measuring));

chkRefine.addEventListener("change", () => {
  refine = chkRefine.checked;
  refineRangeWrap.style.display = refine ? "flex" : "none";
  updateGrid();
  scheduleResample();
});

rangeRefine.addEventListener("input", () => {
  refineFrac = parseInt(rangeRefine.value, 10) / 100;
  refineValue.textContent = `${rangeRefine.value}%`;
  if (refine) {
    updateGrid();
    scheduleResample();
  }
});

let colorTimer = 0;
function scheduleReduction(): void {
  window.clearTimeout(colorTimer);
  colorTimer = window.setTimeout(applyReduction, 110);
}

function setKeepColors(value: number, echoTo: HTMLInputElement): void {
  const max = Math.max(2, hist.length);
  keepColors = Math.min(max, Math.max(2, Math.round(value) || 2));
  echoTo.value = keepColors.toString();
  scheduleReduction();
}

rangeColors.addEventListener("input", () => setKeepColors(parseInt(rangeColors.value, 10), numColors));
numColors.addEventListener("input", () => {
  const value = parseInt(numColors.value, 10);
  if (!Number.isFinite(value)) return;
  keepColors = Math.min(Math.max(2, hist.length), Math.max(2, value));
  rangeColors.value = keepColors.toString();
  scheduleReduction();
});
numColors.addEventListener("change", () => {
  numColors.value = keepColors.toString();
});

rangeBalance.addEventListener("input", () => {
  balance = parseInt(rangeBalance.value, 10) / 100;
  balanceValue.textContent = `${rangeBalance.value}%`;
  scheduleReduction();
});

btnDownload.addEventListener("click", () => {
  if (cols === 0 || rows === 0) return;
  const out = document.createElement("canvas");
  if (selExport.value === "cell") {
    out.width = cols;
    out.height = rows;
    const ctx = out.getContext("2d") as CanvasRenderingContext2D;
    const img = ctx.createImageData(cols, rows);
    img.data.set(finalBuf);
    ctx.putImageData(img, 0, 0);
  } else {
    out.width = canvasPreview.width;
    out.height = canvasPreview.height;
    const ctx = out.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(canvasPreview, 0, 0);
  }
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pixelalign_${out.width}x${out.height}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
});

window.addEventListener("resize", () => {
  if (source) drawOriginal();
});

[inCellW, inCellH, inOffX, inOffY].forEach((el) => enhanceNumber(el));
enhanceNumber(numColors, "w-24 shrink-0");
syncTheme(document.documentElement.classList.contains("dark"));
setLang(lang);
