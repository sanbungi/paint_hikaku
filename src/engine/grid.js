import { Mask, maskBBox, rasterizePolyline } from './raster.js';
import { point } from './types.js';

/** n=0 はなし。2 なら中央十字、3 なら 3×3 マス。 */
export function stampGrid(m, n) {
  if (n < 2 || m.w < 2 || m.h < 2) return;
  for (let i = 1; i < n; i++) {
    const x = Math.trunc((i * (m.w - 1)) / n);
    const y = Math.trunc((i * (m.h - 1)) / n);
    for (let yy = 0; yy < m.h; yy++) m.set(x, yy);
    for (let xx = 0; xx < m.w; xx++) m.set(xx, y);
  }
}

export function stampBBox(m, src, width = 2) {
  const b = maskBBox(src);
  if (b.empty) return;
  const pts = [point(b.x0, b.y0), point(b.x1, b.y0), point(b.x1, b.y1), point(b.x0, b.y1)];
  rasterizePolyline(m, pts, width, true);
}

/** 採点に入れない練習ガイド（グリッド＋任意でお手本の外接箱）。 */
export function practiceGuides(size, gridN, tpl, showBox) {
  const g = new Mask(size, size);
  stampGrid(g, gridN);
  if (showBox) stampBBox(g, tpl, 2);
  return g;
}

export function overlayGuides(rgba, g, r, gg, b) {
  if (rgba.length !== g.px.length * 4) return;
  for (let i = 0; i < g.px.length; i++) {
    if (!g.px[i]) continue;
    const o = i * 4;
    // インクの上には薄く乗せる
    rgba[o] = Math.trunc((rgba[o] * 2 + r) / 3);
    rgba[o + 1] = Math.trunc((rgba[o + 1] * 2 + gg) / 3);
    rgba[o + 2] = Math.trunc((rgba[o + 2] * 2 + b) / 3);
  }
}
