import { AlignMode, createMetrics } from './types.js';
import { distanceTransform, maskBBox, maskCentroid, shiftMask } from './raster.js';

export function compareMasks(tpl, user) {
  const m = createMetrics();
  let inter = 0;
  let uni = 0;
  let tN = 0;
  let uN = 0;
  let miss = 0;
  let extra = 0;
  for (let i = 0; i < tpl.px.length; i++) {
    const t = tpl.px[i] !== 0;
    const u = user.px[i] !== 0;
    if (t) tN++;
    if (u) uN++;
    if (t && u) inter++;
    if (t || u) uni++;
    if (t && !u) miss++;
    if (u && !t) extra++;
  }
  m.iou = uni === 0 ? 0 : inter / uni;
  m.missRate = tN === 0 ? 0 : miss / tN;
  m.extraRate = uN === 0 ? 0 : extra / uN;

  const dtT = distanceTransform(tpl);
  const dtU = distanceTransform(user);
  let su = 0;
  let st = 0;
  let nu = 0;
  let nt = 0;
  for (let i = 0; i < tpl.px.length; i++) {
    if (user.px[i] && dtT[i] < 1e7) {
      su += dtT[i];
      nu++;
    }
    if (tpl.px[i] && dtU[i] < 1e7) {
      st += dtU[i];
      nt++;
    }
  }
  m.chamferUserToTpl = nu ? su / nu : 0;
  m.chamferTplToUser = nt ? st / nt : 0;

  const ct = maskCentroid(tpl);
  const cu = maskCentroid(user);
  m.dx = cu.x - ct.x;
  m.dy = cu.y - ct.y;

  const bt = maskBBox(tpl);
  const bu = maskBBox(user);
  const ts = Math.sqrt(Math.max(1, bt.width * bt.height));
  const us = Math.sqrt(Math.max(1, bu.width * bu.height));
  m.scaleRatio = us / ts;
  const ta = bt.height > 0 ? bt.width / bt.height : 1;
  const ua = bu.height > 0 ? bu.width / bu.height : 1;
  m.aspectRatio = ta > 0 ? ua / ta : 1;

  // PCA-like: covariance of ink pixels for orientation
  m.angleDeg = principalAngle(user) - principalAngle(tpl);

  // quadrant coverage of template
  const tq = [0, 0, 0, 0];
  const uq = [0, 0, 0, 0];
  for (let y = 0; y < tpl.h; y++) {
    for (let x = 0; x < tpl.w; x++) {
      const i = y * tpl.w + x;
      if (!tpl.px[i]) continue;
      const q = (x >= ct.x ? 1 : 0) + (y >= ct.y ? 2 : 0);
      tq[q]++;
      if (user.px[i]) uq[q]++;
    }
  }
  const cov = (q) => (tq[q] === 0 ? 1 : uq[q] / tq[q]);
  m.coverTL = cov(0);
  m.coverTR = cov(1);
  m.coverBL = cov(2);
  m.coverBR = cov(3);
  return m;
}

export function principalAngle(m) {
  const c = maskCentroid(m);
  if (c.count < 10) return 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.px[y * m.w + x]) continue;
      const dx = x - c.x;
      const dy = y - c.y;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
  }
  return (Math.atan2(2 * sxy, sxx - syy) * 0.5 * 180) / Math.PI;
}

export function alignedUser(tpl, user, mode) {
  if (mode === AlignMode.none) return user.dup();
  const ct = maskCentroid(tpl);
  const cu = maskCentroid(user);
  return shiftMask(user, Math.trunc(ct.x - cu.x), Math.trunc(ct.y - cu.y));
}
