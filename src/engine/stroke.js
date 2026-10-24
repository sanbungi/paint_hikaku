import { point } from './types.js';

/** Catmull-Rom sample between p1 and p2 (p0, p3 are neighbors). */
export function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t
    + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
    + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t
    + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
    + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return point(x, y, p1.pressure * (1 - t) + p2.pressure * t, p1.timeMs);
}

export function interpolateStroke(stroke, spacing = 1.25) {
  const pts = stroke.points;
  if (pts.length === 0) return [];
  if (pts.length === 1) return [pts[0]];
  const at = (i) => (i >= pts.length ? pts[pts.length - 1] : pts[i]);
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i === 0 ? 0 : i - 1);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = at(i + 2);
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(1, Math.floor(dist / spacing));
    for (let k = 1; k <= n; k++) out.push(catmull(p0, p1, p2, p3, k / n));
  }
  return out;
}

/** Mean perpendicular deviation from local chord; high = shaky line. */
export function strokeJitter(strokes) {
  let acc = 0;
  let n = 0;
  for (const s of strokes) {
    const p = s.points;
    if (p.length < 5) continue;
    for (let i = 2; i < p.length - 2; i++) {
      let cx = p[i + 2].x - p[i - 2].x;
      let cy = p[i + 2].y - p[i - 2].y;
      const len = Math.hypot(cx, cy);
      if (len < 1) continue;
      cx /= len;
      cy /= len;
      const vx = p[i].x - p[i - 2].x;
      const vy = p[i].y - p[i - 2].y;
      acc += Math.abs(vx * -cy + vy * cx);
      n++;
    }
  }
  return n === 0 ? 0 : acc / n;
}
