import { Mask, maskBBox, stampDisc } from './raster.js';

/**
 * Underdrawing export (下絵) from the pose editor: the posed figure rendered as separate
 * layers (shading, silhouette, line art) plus construction guides (bounding boxes, a stick
 * skeleton, the floor and eye level), composed into one PNG or saved one PNG per layer.
 * This module is GUI-free: the renderer supplies pixels and projected guide geometry.
 */

/** Bottom to top. `kind`: rgba = rendered pixels, mask = ink drawn in one colour. */
export const UnderLayers = [
  { id: 'shaded', labelJa: '陰影（モデルの画像）', shortJa: '陰影', kind: 'rgba' },
  { id: 'silhouette', labelJa: 'シルエット', shortJa: 'シルエット', kind: 'mask', color: '#b9b4cc', alpha: 0.6 },
  { id: 'floor', labelJa: '床グリッドと目線', shortJa: '床と目線', kind: 'mask', color: '#9a958a', alpha: 0.9 },
  { id: 'box3d', labelJa: '外接箱（立体・パース）', shortJa: '外接箱（立体）', kind: 'mask', color: '#3a7bd5', alpha: 0.9 },
  { id: 'bbox', labelJa: '外接箱（画面）と中心線', shortJa: '外接箱（画面）', kind: 'mask', color: '#d23c3c', alpha: 0.9 },
  { id: 'skeleton', labelJa: '骨格（アタリ）', shortJa: '骨格', kind: 'mask', color: '#2f9a5a', alpha: 0.9 },
  { id: 'lines', labelJa: '線画（輪郭と折れ目）', shortJa: '線画', kind: 'mask', color: '#1c1c20', alpha: 1 },
];

export const layerById = (id) => UnderLayers.find((l) => l.id === id) ?? null;

/** Width ÷ height. */
export const Aspects = {
  portrait: { labelJa: '縦 3:4', value: 3 / 4 },
  a4portrait: { labelJa: 'A4 縦', value: 1 / Math.SQRT2 },
  square: { labelJa: '正方形', value: 1 },
  landscape: { labelJa: '横 4:3', value: 4 / 3 },
  a4landscape: { labelJa: 'A4 横', value: Math.SQRT2 },
  tall: { labelJa: '縦 9:16', value: 9 / 16 },
  wide: { labelJa: '横 16:9', value: 16 / 9 },
};

export const LongSides = [1024, 2048, 3000, 4096];

export function defaultUnderdrawingOptions() {
  return {
    framing: 'fit', // fit = crop to the figure, view = what the view shows
    aspect: 'portrait',
    longSide: 2048,
    margin: 0.06, // around the figure when fitting (fraction of the longer side)
    layers: { shaded: true, silhouette: false, floor: true, box3d: false, bbox: true, skeleton: false, lines: true },
    shadedOpacity: 0.45, // faint shading reads as an underdrawing
    lineWidth: 3, // px at the output size
    guideWidth: 2,
    background: 'white', // white | transparent
  };
}

/** Output pixel size for a long side and an aspect (width ÷ height). */
export function exportSize(longSide, aspect) {
  return aspect >= 1
    ? { width: longSide, height: Math.max(1, Math.round(longSide / aspect)) }
    : { width: Math.max(1, Math.round(longSide * aspect)), height: longSide };
}

/**
 * Crop (in probe pixels) around a figure's bounding box with a margin, widened to `aspect`
 * and centred. May extend past the probe: the camera crop is only frustum maths.
 */
export function fitCrop(bbox, aspect, margin) {
  if (bbox.empty) return null;
  const cx = (bbox.x0 + bbox.x1 + 1) / 2;
  const cy = (bbox.y0 + bbox.y1 + 1) / 2;
  const pad = Math.max(bbox.width, bbox.height) * margin;
  let w = bbox.width + pad * 2;
  let h = bbox.height + pad * 2;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** The largest rectangle of `aspect` centred in a w×h view (for the export frame overlay). */
export function frameInView(w, h, aspect) {
  const fw = Math.min(w, h * aspect);
  const fh = fw / aspect;
  return { x: (w - fw) / 2, y: (h - fh) / 2, width: fw, height: fh };
}

// ---------------------------------------------------------------- guide geometry

/** Screen bounding box of the figure, its centre lines (dashed) and halves. */
export function bboxGuides(coverage) {
  const b = maskBBox(coverage);
  if (b.empty) return { lines: [] };
  const x0 = b.x0;
  const y0 = b.y0;
  const x1 = b.x1 + 1;
  const y1 = b.y1 + 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    lines: [
      { pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true },
      { pts: [[cx, y0], [cx, y1]], dash: [10, 7] },
      { pts: [[x0, cy], [x1, cy]], dash: [10, 7] },
    ],
  };
}

/** The 12 edges of a box from its 8 projected corners (index bits: x, y, z); null = behind. */
export function boxEdges(corners) {
  const lines = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      const j = i | bit;
      if (j !== i && corners[i] && corners[j]) lines.push({ pts: [corners[i], corners[j]] });
    }
  }
  return { lines };
}

function stampSegment(m, a, b, radius) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, radius * 0.6)));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    stampDisc(m, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius);
  }
}

/** Splits a segment into dashes [on, off] (pixels). */
function dashes(a, b, [on, off]) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out = [];
  for (let s = 0; s < len; s += on + off) {
    const e = Math.min(len, s + on);
    const p = (d) => [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
    out.push([p(s), p(e)]);
  }
  return out;
}

/**
 * Draws guide geometry into a mask: `lines` (straight segments, optionally closed or dashed),
 * `circles` { x, y, r } outlines and `dots` { x, y, r } filled.
 */
export function rasterizeGuides(w, h, { lines = [], circles = [], dots = [] }, width = 2) {
  const m = new Mask(w, h);
  const radius = Math.max(0.5, width / 2);
  const dashScale = Math.max(1, width / 2);
  for (const { pts, closed = false, dash = null } of lines) {
    const seq = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < seq.length; i++) {
      if (dash) for (const [a, b] of dashes(seq[i], seq[i + 1], dash.map((d) => d * dashScale))) stampSegment(m, a, b, radius);
      else stampSegment(m, seq[i], seq[i + 1], radius);
    }
    if (seq.length === 1) stampDisc(m, seq[0][0], seq[0][1], radius);
  }
  for (const { x, y, r } of circles) {
    const n = Math.max(24, Math.ceil(r));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      stampSegment(m, [x + r * Math.cos(a0), y + r * Math.sin(a0)], [x + r * Math.cos(a1), y + r * Math.sin(a1)], radius);
    }
  }
  for (const { x, y, r } of dots) stampDisc(m, x, y, r);
  return m;
}

// ---------------------------------------------------------------- composition

export function hexColor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [0, 0, 0];
}

/** Paints one layer over `out` (straight-alpha RGBA, "source over"). */
function paint(out, layer, data, opacity) {
  const n = out.length / 4;
  if (layer.kind === 'rgba') {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const a = (data[o + 3] / 255) * opacity;
      if (a > 0) blend(out, o, data[o], data[o + 1], data[o + 2], a);
    }
    return;
  }
  const [r, g, b] = hexColor(layer.color);
  const a0 = (layer.alpha ?? 1) * opacity;
  for (let i = 0; i < n; i++) if (data.px[i]) blend(out, i * 4, r, g, b, a0 * (data.px[i] / 255));
}

function blend(out, o, r, g, b, a) {
  const da = out[o + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  out[o] = (r * a + out[o] * da * (1 - a)) / oa;
  out[o + 1] = (g * a + out[o + 1] * da * (1 - a)) / oa;
  out[o + 2] = (b * a + out[o + 2] * da * (1 - a)) / oa;
  out[o + 3] = oa * 255;
}

/**
 * Composes layers into RGBA. `data` maps layer id → Uint8ClampedArray (rgba) or Mask;
 * only ids enabled in `options.layers` (or listed in `only`) are drawn.
 */
export function composeUnderdrawing(w, h, data, options, { only = null, background = options.background } = {}) {
  const out = new Uint8ClampedArray(w * h * 4);
  if (background === 'white') out.fill(255);
  for (const layer of UnderLayers) {
    const on = only ? only.includes(layer.id) : options.layers[layer.id];
    if (!on || !data[layer.id]) continue;
    paint(out, layer, data[layer.id], layer.id === 'shaded' ? options.shadedOpacity : 1);
  }
  return out;
}

/** File-safe base name (Windows-reserved characters replaced). */
export function safeFileName(name, fallback = '下絵') {
  const s = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  return (s || fallback).slice(0, 80);
}
