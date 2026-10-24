import { CanvasSize, DefaultStrokeWidth, point as P } from './types.js';
import { Mask, rasterizePolyline, stampDisc } from './raster.js';
import { defaultPerspective, drawMesh } from './perspective.js';
import { isSolidId, solidById } from './solids.js';

export function builtinCatalog() {
  return [
    { id: 'line', labelJa: '直線', kind: 'shape' },
    { id: 'circle', labelJa: '円', kind: 'shape' },
    { id: 'ellipse', labelJa: '楕円', kind: 'shape' },
    { id: 'rect', labelJa: '矩形', kind: 'shape' },
    { id: 'triangle', labelJa: '正三角形', kind: 'shape' },
    { id: 'pentagon', labelJa: '正五角形', kind: 'shape' },
    { id: 'cross', labelJa: '十字', kind: 'shape' },
    { id: 'curve_s', labelJa: 'S曲線', kind: 'shape' },
    { id: 'drill_2dots', labelJa: '線練習: 2点を結ぶ', kind: 'drill' },
    { id: 'drill_angles', labelJa: '線練習: 斜め3本', kind: 'drill' },
    { id: 'drill_circles', labelJa: '線練習: 円3つ', kind: 'drill' },
    { id: 'solid_cube', labelJa: '立方体', kind: 'solid' },
    { id: 'solid_box', labelJa: '直方体', kind: 'solid' },
    { id: 'solid_cylinder', labelJa: '円柱', kind: 'solid' },
    { id: 'solid_hexprism', labelJa: '六角柱', kind: 'solid' },
    { id: 'solid_pyramid', labelJa: '四角錐', kind: 'solid' },
    { id: 'solid_cone', labelJa: '円錐', kind: 'solid' },
    { id: 'solid_sphere', labelJa: '球', kind: 'solid' },
  ];
}

export function renderTemplate(id, ps = defaultPerspective(), size = CanvasSize, width = DefaultStrokeWidth) {
  if (isSolidId(id)) {
    const ink = new Mask(size, size);
    const guides = new Mask(size, size);
    drawMesh(ink, guides, solidById(id), ps, size, width);
    return { ink, guides };
  }
  return { ink: renderBuiltin(id, size, width), guides: new Mask(size, size) };
}

function ringPoints(cx, cy, rx, ry, n, start = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = start + (2 * Math.PI * i) / n;
    pts.push(P(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
  }
  return pts;
}

export function renderBuiltin(id, size = CanvasSize, width = DefaultStrokeWidth) {
  if (isSolidId(id)) return renderTemplate(id, defaultPerspective(), size, width).ink;
  const m = new Mask(size, size);
  const cx = size * 0.5;
  const cy = size * 0.5;
  const s = size * 0.32;
  const line = (pts, closed = false) => rasterizePolyline(m, pts, width, closed);

  switch (id) {
    case 'circle':
      line(ringPoints(cx, cy, s, s, 64), true);
      break;
    case 'ellipse':
      line(ringPoints(cx, cy, s * 1.25, s * 0.7, 64), true);
      break;
    case 'rect': {
      const hw = s;
      const hh = s * 0.75;
      line([P(cx - hw, cy - hh), P(cx + hw, cy - hh), P(cx + hw, cy + hh), P(cx - hw, cy + hh)], true);
      break;
    }
    case 'triangle':
      line(ringPoints(cx, cy, s, s, 3, -Math.PI / 2), true);
      break;
    case 'pentagon':
      line(ringPoints(cx, cy, s, s, 5, -Math.PI / 2), true);
      break;
    case 'cross':
      line([P(cx - s, cy), P(cx + s, cy)]);
      line([P(cx, cy - s), P(cx, cy + s)]);
      break;
    case 'curve_s': {
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const t = i / 47;
        pts.push(P(cx + (t - 0.5) * 2 * s, cy + Math.sin(t * Math.PI * 2) * s * 0.45));
      }
      line(pts);
      break;
    }
    case 'drill_2dots':
      stampDisc(m, cx - s, cy, width * 1.4);
      stampDisc(m, cx + s, cy, width * 1.4);
      break;
    case 'drill_angles':
      for (const [ox, oy] of [[-1, 0.5], [1, -0.5], [-0.2, -1], [0.6, 1], [-1, -0.15], [0.15, 0.7]]) {
        stampDisc(m, cx + s * ox, cy + s * oy, width * 1.2);
      }
      break;
    case 'drill_circles':
      line(ringPoints(cx - s * 0.55, cy, s * 0.38, s * 0.38, 48), true);
      line(ringPoints(cx + s * 0.35, cy - s * 0.35, s * 0.28, s * 0.28, 48), true);
      line(ringPoints(cx + s * 0.25, cy + s * 0.45, s * 0.22, s * 0.22, 48), true);
      break;
    case 'line':
    default:
      line([P(cx - s, cy), P(cx + s, cy)]);
      break;
  }
  return m;
}

/** Dark pixels of an RGBA image become ink (luma < threshold; transparent = paper). */
export function fromRgbaInk(rgba, w, h, threshold = 128) {
  const m = new Mask(w, h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let luma = Math.trunc((rgba[o] * 30 + rgba[o + 1] * 59 + rgba[o + 2] * 11) / 100);
    if (rgba[o + 3] < 16) luma = 255;
    m.px[i] = luma < threshold ? 255 : 0;
  }
  return m;
}
