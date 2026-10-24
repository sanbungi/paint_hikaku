import { Mask, stampDisc } from './raster.js';

/** Perspective depth buffer value (0..1, OpenGL convention) to distance from the camera. */
export function linearizeDepth(fragCoordZ, near, far) {
  const ndc = fragCoordZ * 2 - 1;
  return (2 * near * far) / (far + near - ndc * (far - near));
}

/**
 * Line drawing from G-buffers of a 3D render (rows top to bottom):
 * silhouettes (object vs background), occlusion edges (depth jumps) and,
 * when creaseDeg > 0, creases (normal turns sharper than creaseDeg).
 * `depth` holds camera distances, `coverage` is >0 where the object covers the pixel,
 * `normals` are unit vectors packed xyz per pixel (stride 3) or null.
 */
export function edgesFromBuffers({ w, h, depth, coverage, normals = null }, {
  depthTolerance = 0.02, creaseDeg = 40, radius = 1.25,
} = {}) {
  const edge = new Uint8Array(w * h);
  const minDot = Math.cos((creaseDeg * Math.PI) / 180);
  // For each neighbour pair the nearer pixel gets the line, so it hugs the front surface.
  const consider = (p, q) => {
    const fp = coverage[p] > 0;
    const fq = coverage[q] > 0;
    if (!fp && !fq) return;
    if (fp !== fq) {
      edge[fp ? p : q] = 1;
      return;
    }
    const dp = depth[p];
    const dq = depth[q];
    if (Math.abs(dp - dq) > depthTolerance * Math.min(dp, dq)) {
      edge[dp < dq ? p : q] = 1;
      return;
    }
    if (normals && creaseDeg > 0) {
      const d = normals[p * 3] * normals[q * 3] + normals[p * 3 + 1] * normals[q * 3 + 1]
        + normals[p * 3 + 2] * normals[q * 3 + 2];
      if (d < minDot) edge[p] = 1;
    }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w) consider(i, i + 1);
      if (y + 1 < h) consider(i, i + w);
    }
  }
  const m = new Mask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edge[y * w + x]) {
        if (radius <= 0.5) m.set(x, y);
        else stampDisc(m, x + 0.5, y + 0.5, radius);
      }
    }
  }
  return m;
}

/** Shaded render with its scoring lines drawn on top (dark blue, like the line templates). */
export function overlayLines(color, ink, [r, g, b] = [50, 90, 210], alpha = 0.85) {
  const out = new Uint8ClampedArray(color);
  for (let i = 0; i < ink.px.length; i++) {
    if (!ink.px[i]) continue;
    const o = i * 4;
    out[o] = Math.round(out[o] * (1 - alpha) + r * alpha);
    out[o + 1] = Math.round(out[o + 1] * (1 - alpha) + g * alpha);
    out[o + 2] = Math.round(out[o + 2] * (1 - alpha) + b * alpha);
  }
  return out;
}
