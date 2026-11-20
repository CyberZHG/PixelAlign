export type Lang = "en" | "zh";

type Dict = Record<string, string>;

const en: Dict = {
  tagline: "Align AI pixel art to a clean grid, then prune stray colors.",
  upload: "Upload image",
  dropHint: "Drop an image here, or click to browse",
  replaceImage: "Replace image",
  grid: "Grid",
  autoDetect: "Auto detect",
  cellW: "Cell width",
  cellH: "Cell height",
  offsetX: "Offset X",
  offsetY: "Offset Y",
  sampling: "Sampling",
  dominant: "Dominant",
  average: "Average",
  center: "Center",
  showGrid: "Show grid overlay",
  measure: "Measure a cell on the image",
  measureActive: "Click two adjacent grid lines",
  refine: "Snap each line to edges",
  refineRange: "Search range",
  colors: "Colors",
  targetColors: "Target colors",
  palette: "Palette",
  exportLabel: "Export",
  exportMode: "Output",
  exportFull: "Actual size",
  exportCell: "1 px per cell",
  download: "Download PNG",
  original: "Original",
  preview: "Preview",
  empty: "Upload a pixel-art image to begin",
  cellsUnit: "cells",
  colorsUnit: "colors",
  reducedTo: "kept",
};

const zh: Dict = {
  tagline: "把 AI 像素图对齐到规整网格，再清除杂色。",
  upload: "上传图片",
  dropHint: "将图片拖到此处，或点击选择",
  replaceImage: "更换图片",
  grid: "网格",
  autoDetect: "自动识别",
  cellW: "格子宽度",
  cellH: "格子高度",
  offsetX: "横向偏移",
  offsetY: "纵向偏移",
  sampling: "取色方式",
  dominant: "众数",
  average: "平均",
  center: "中心",
  showGrid: "显示网格",
  measure: "在图上测量格子",
  measureActive: "点击相邻的两条网格线",
  refine: "按边缘微调每条分隔线",
  refineRange: "搜索范围",
  colors: "颜色",
  targetColors: "目标颜色数",
  palette: "调色板",
  exportLabel: "导出",
  exportMode: "输出",
  exportFull: "原图尺寸",
  exportCell: "每格 1 像素",
  download: "下载 PNG",
  original: "原图",
  preview: "预览",
  empty: "上传一张像素图开始",
  cellsUnit: "格",
  colorsUnit: "色",
  reducedTo: "保留",
};

const dicts: Record<Lang, Dict> = { en, zh };

const STORAGE_KEY = "pixelalign.lang";

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

export function t(lang: Lang, key: string): string {
  return dicts[lang][key] ?? key;
}

export function applyLang(lang: Lang, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n as string);
  });
  document.documentElement.lang = lang;
}
