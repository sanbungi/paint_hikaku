import { CanvasSize, DefaultStrokeWidth, OverlayMode } from './types.js';
import { interpolateStroke } from './stroke.js';

/** Binary ink mask: 0 empty, 255 ink. */
export class Mask {
  constructor(w = CanvasSize, h = CanvasSize, px = null) {
    this.w = w;
    this.h = h;
    this.px = px ?? new Uint8Array(w * h);
  }

  dup() {
    return new Mask(this.w, this.h, this.px.slice());
  }

  clear() {
    this.px.fill(0);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  at(x, y) {
    return this.px[y * this.w + x];
  }

  set(x, y, v = 255) {
    this.px[y * this.w + x] = v;
  }
}

export function samePixels(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function stampDisc(m, cx, cy, radius) {
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx) - r);
  const y0 = Math.max(0, Math.floor(cy) - r);
  const x1 = Math.min(m.w - 1, Math.ceil(cx) + r);
  const y1 = Math.min(m.h - 1, Math.ceil(cy) + r);
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const row = y * m.w;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) m.px[row + x] = 255;
    }
  }
}

export function rasterizeStrokes(m, strokes, baseWidth = DefaultStrokeWidth) {
  for (const s of strokes) {
    for (const p of interpolateStroke(s)) {
      stampDisc(m, p.x, p.y, baseWidth * 0.5 * Math.max(0.08, p.pressure));
    }
  }
}

export function rasterizePolyline(m, pts, width = DefaultStrokeWidth, closed = false) {
  const points = pts.slice();
  if (closed && pts.length > 2) points.push(pts[0]);
  rasterizeStrokes(m, [{ points }], width);
}

export function maskCentroid(m) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < m.h; y++) {
    const row = y * m.w;
    for (let x = 0; x < m.w; x++) {
      if (m.px[row + x]) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n, count: n } : { x: 0, y: 0, count: 0 };
}

export function maskBBox(m) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < m.h; y++) {
    const row = y * m.w;
    for (let x = 0; x < m.w; x++) {
      if (!m.px[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const empty = x0 > x1;
  return {
    x0, y0, x1, y1, empty,
    width: empty ? 0 : x1 - x0 + 1,
    height: empty ? 0 : y1 - y0 + 1,
  };
}

export function shiftMask(src, dx, dy) {
  const d = new Mask(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= src.h) continue;
    for (let x = 0; x < src.w; x++) {
      const nx = x + dx;
      if (src.px[y * src.w + x] && nx >= 0 && nx < src.w) d.px[ny * src.w + nx] = 255;
    }
  }
  return d;
}

export const DistanceInf = 1e8;

/** Two-pass chamfer DT. Result is distance in pixels (approx). */
export function distanceTransform(m) {
  const { w, h } = m;
  const D = Math.fround(1.414);
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = m.px[i] ? 0 : DistanceInf;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) v = Math.min(v, d[i - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + D);
      if (x + 1 < w && y > 0) v = Math.min(v, d[i - w + 1] + D);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x + 1 < w) v = Math.min(v, d[i + 1] + 1);
      if (y + 1 < h) v = Math.min(v, d[i + w] + 1);
      if (x + 1 < w && y + 1 < h) v = Math.min(v, d[i + w + 1] + D);
      if (x > 0 && y + 1 < h) v = Math.min(v, d[i + w - 1] + D);
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) if (d[i] >= DistanceInf / 2) d[i] = DistanceInf;
  return d;
}

export function hasColorTpl(color, w, h) {
  return color != null && color.length === w * h * 4;
}

function mixToward(out, o, nr, ng, nb, num = 1, den = 2) {
  out[o] = Math.trunc((out[o] * (den - num) + nr * num) / den);
  out[o + 1] = Math.trunc((out[o + 1] * (den - num) + ng * num) / den);
  out[o + 2] = Math.trunc((out[o + 2] * (den - num) + nb * num) / den);
}

function put(out, o, r, g, b) {
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = 255;
}

/** Overlay visualization into packed RGBA8888 (ImageData compatible). */
export function composeOverlay(tpl, user, mode, heatDt = null, color = null) {
  const n = tpl.w * tpl.h;
  const out = new Uint8ClampedArray(n * 4);
  const col = hasColorTpl(color, tpl.w, tpl.h);
  // overlay, diff and wipe share the same colouring rule, only the tones differ.
  const tones = mode === OverlayMode.diff
    ? { tpl: [40, 80, 200], user: [220, 40, 40] }
    : { tpl: [50, 90, 210], user: [210, 60, 70] };
  for (let i = 0; i < n; i++) {
    const t = tpl.px[i] !== 0;
    const u = user.px[i] !== 0;
    const o = i * 4;
    if (col) put(out, o, color[o], color[o + 1], color[o + 2]);
    else put(out, o, 245, 245, 242);
    if (mode === OverlayMode.heat) {
      if (u && heatDt) {
        const t01 = Math.min(1, heatDt[i] / 24);
        put(out, o, Math.trunc(40 + t01 * 200), Math.trunc(180 - t01 * 160), 50);
      } else if (!col && t) {
        put(out, o, 200, 200, 210);
      }
      continue;
    }
    if (col) {
      if (u && t) mixToward(out, o, 40, 170, 90, 1, 2);
      else if (u) mixToward(out, o, ...tones.user, 2, 3);
    } else if (t && u) put(out, o, 40, 170, 90);
    else if (t) put(out, o, ...tones.tpl);
    else if (u) put(out, o, ...tones.user);
  }
  return out;
}

export function composeHiddenSample(w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let o = 0; o < out.length; o += 4) put(out, o, 232, 230, 224);
  return out;
}

export function composeSample(tpl, guides, color = null) {
  const n = tpl.w * tpl.h;
  const out = new Uint8ClampedArray(n * 4);
  const hasG = guides != null && guides.px.length === tpl.px.length;
  const col = hasColorTpl(color, tpl.w, tpl.h);
  for (let i = 0; i < n; i++) {
    const t = tpl.px[i] !== 0;
    const gd = hasG && guides.px[i] !== 0;
    const o = i * 4;
    if (col) {
      put(out, o, color[o], color[o + 1], color[o + 2]);
      if (gd) mixToward(out, o, 180, 176, 160, 1, 3);
    } else if (t) put(out, o, 50, 90, 210);
    else if (gd) put(out, o, 210, 206, 196);
    else put(out, o, 250, 249, 245);
  }
  return out;
}

export function composePaper(user) {
  const n = user.w * user.h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (user.px[i]) put(out, i * 4, 28, 28, 32);
    else put(out, i * 4, 255, 255, 255);
  }
  return out;
}

export function composeWipe(tpl, user, guides, wipePct, color = null) {
  const { w, h } = tpl;
  const out = new Uint8ClampedArray(w * h * 4);
  const hasG = guides != null && guides.px.length === tpl.px.length;
  const col = hasColorTpl(color, w, h);
  const split = Math.max(0, Math.min(w, Math.trunc((wipePct * w) / 100)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (x === split || x === split - 1) put(out, o, 40, 40, 45);
      else if (x < split) {
        if (col) put(out, o, color[o], color[o + 1], color[o + 2]);
        else if (tpl.px[i]) put(out, o, 50, 90, 210);
        else if (hasG && guides.px[i]) put(out, o, 210, 206, 196);
        else put(out, o, 250, 249, 245);
      } else if (user.px[i]) put(out, o, 200, 50, 60);
      else put(out, o, 255, 255, 255);
    }
  }
  return out;
}
