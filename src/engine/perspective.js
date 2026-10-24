import { rasterizePolyline } from './raster.js';
import { point } from './types.js';

export const PerspMode = Object.freeze({
  onePoint: 'onePoint',
  twoPoint: 'twoPoint',
  threePoint: 'threePoint',
  isometric: 'isometric',
});
export const PerspModes = [PerspMode.onePoint, PerspMode.twoPoint, PerspMode.threePoint, PerspMode.isometric];

export function defaultPerspective() {
  return {
    mode: PerspMode.twoPoint,
    yawDeg: 32, // 水平回転（2点・3点）
    pitchDeg: 16, // 上下（3点）
    dist: 55, // カメラ距離 1（至近）–90（遠い）
    horizonPct: 42, // 地平線の位置（上から %）
    showGuides: true,
    showHidden: true,
  };
}

export const v3 = (x, y, z) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export function nrm(a) {
  const L = Math.sqrt(dot(a, a));
  return L < 1e-8 ? a : mul(a, 1 / L);
}

function rotY(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return v3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

function rotX(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return v3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

const rad = (deg) => (deg * Math.PI) / 180;

export function makeCam(ps, size) {
  const c = {
    cx: size * 0.5,
    cy: size * 0.5,
    ortho: ps.mode === PerspMode.isometric,
    isoS: size * 0.22,
    yaw: 0,
    pitch: 0,
  };
  switch (ps.mode) {
    case PerspMode.onePoint:
      break;
    case PerspMode.twoPoint:
      c.yaw = rad(ps.yawDeg);
      break;
    case PerspMode.threePoint:
      c.yaw = rad(ps.yawDeg);
      c.pitch = rad(ps.pitchDeg);
      break;
    case PerspMode.isometric:
      c.yaw = rad(45);
      c.pitch = rad(35.264);
      break;
    default:
      throw new Error(`unknown perspective mode: ${ps.mode}`);
  }
  // dist=1 でほぼ接写、25 で旧「最寄り」よりさらに近い。
  c.camDist = 0.48 + ps.dist / 10;
  c.camY = (50 - ps.horizonPct) / 80;
  c.f = size * 0.62;
  return c;
}

export function toCam(c, p) {
  const q = rotX(rotY(p, c.yaw), c.pitch);
  q.y -= c.camY;
  return q;
}

export function project(c, p) {
  const q = toCam(c, p);
  if (c.ortho) {
    return point(
      c.cx + (q.x - q.z) * c.isoS * 0.866,
      c.cy - (q.y * c.isoS + (q.x + q.z) * c.isoS * 0.5),
    );
  }
  const z = Math.max(0.12, q.z + c.camDist);
  return point(c.cx + (c.f * q.x) / z, c.cy - (c.f * q.y) / z);
}

/** Vanishing point of a world-space axis, or null if parallel / far off-canvas. */
export function vanishingPoint(c, dir, size) {
  if (c.ortho) return null;
  const d = rotX(rotY(nrm(dir), c.yaw), c.pitch);
  if (Math.abs(d.z) < 0.08) return null;
  const vx = c.cx + (c.f * d.x) / d.z;
  const vy = c.cy - (c.f * d.y) / d.z;
  if (vx < -size * 0.15 || vx > size * 1.15 || vy < -size * 0.2 || vy > size * 1.2) return null;
  return point(vx, vy);
}

export function faceFront(c, mesh, face) {
  if (face.length < 3) return true;
  const a = toCam(c, mesh.v[face[0]]);
  const b = toCam(c, mesh.v[face[1]]);
  const cc = toCam(c, mesh.v[face[2]]);
  const n = cross(sub(b, a), sub(cc, a));
  // Camera sits at (0,0,-camDist) looking toward +Z; front if the normal faces it.
  const view = c.ortho ? v3(0.5, 0.5, -1) : v3(-a.x, -a.y, -a.z - c.camDist);
  return dot(n, view) > 0;
}

export function visibleEdges(c, mesh) {
  const vis = new Array(mesh.e.length).fill(mesh.faces.length === 0);
  for (const f of mesh.faces) {
    if (!faceFront(c, mesh, f)) continue;
    for (let k = 0; k < f.length; k++) {
      const i0 = f[k];
      const i1 = f[(k + 1) % f.length];
      mesh.e.forEach((e, ei) => {
        if ((e[0] === i0 && e[1] === i1) || (e[0] === i1 && e[1] === i0)) vis[ei] = true;
      });
    }
  }
  return vis;
}

function strokeLine(m, a, b, w) {
  rasterizePolyline(m, [a, b], w, false);
}

export function drawMesh(ink, guides, mesh, ps, size, width) {
  const cam = makeCam(ps, size);
  const vis = visibleEdges(cam, mesh);
  const scr = mesh.v.map((p) => project(cam, p));

  mesh.e.forEach(([a, b], i) => {
    if (vis[i]) strokeLine(ink, scr[a], scr[b], width);
    else if (ps.showHidden) strokeLine(guides, scr[a], scr[b], Math.max(2, width * 0.45));
  });

  if (!ps.showGuides || cam.ortho) return;

  const hy = size * (ps.horizonPct / 100);
  strokeLine(guides, point(0, hy), point(size - 1, hy), 2);

  for (const ax of [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)]) {
    const vp = vanishingPoint(cam, ax, size);
    if (!vp) continue;
    if (vp.x < 4 || vp.x > size - 4 || vp.y < 4 || vp.y > size - 4) continue;
    strokeLine(guides, point(vp.x - 8, vp.y), point(vp.x + 8, vp.y), 2.5);
    strokeLine(guides, point(vp.x, vp.y - 8), point(vp.x, vp.y + 8), 2.5);
    // a few construction rays to mesh verts
    for (const p of scr.slice(0, 4)) strokeLine(guides, vp, p, 1.6);
  }
}
