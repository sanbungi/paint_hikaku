import * as THREE from '../vendor/three-vrm.js';
import { edgesFromBuffers, linearizeDepth } from '../../engine/edges.js';
import { Mask, maskBBox } from '../../engine/raster.js';
import {
  Aspects, bboxGuides, boxEdges, exportSize, fitCrop, frameInView, rasterizeGuides,
} from '../../engine/underdrawing.js';
import { cutout, withMaterials } from '../figure/studio.js';

/**
 * Renders the pose editor's figure as underdrawing layers with the editor's own renderer:
 * the view camera (cropped to the export frame), the model only (no handles, no grid),
 * a colour pass and depth + normal passes for the line art, then the guides projected
 * through the same camera.
 */

/** Pixels top row first from a render target. */
function read(renderer, target, w, h, Typed) {
  const raw = new Typed(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, raw);
  const out = new Typed(w * h * 4);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

/** Runs `fn` with only the model visible on a transparent background, then restores the view. */
function modelOnly(view, fn) {
  const { renderer, scene } = view;
  const saved = { overlay: view.overlay.visible, grid: view.grid.visible, bg: scene.background, target: renderer.getRenderTarget() };
  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  view.overlay.visible = false;
  view.grid.visible = false;
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  try {
    return fn();
  } finally {
    view.overlay.visible = saved.overlay;
    view.grid.visible = saved.grid;
    scene.background = saved.bg;
    renderer.setClearColor(clear, clearAlpha);
    renderer.setRenderTarget(saved.target);
    view.requestRender();
  }
}

function pass(view, cam, target) {
  view.renderer.setRenderTarget(target);
  view.renderer.clear();
  view.renderer.render(view.scene, cam);
}

/** Depth (camera distance) and coverage of the model. */
function depthPass(view, model, cam, w, h) {
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  try {
    const raw = withMaterials(model.scene, (m) => new THREE.MeshDepthMaterial(cutout(m)), () => {
      pass(view, cam, target);
      return read(view.renderer, target, w, h, Float32Array);
    });
    const depth = new Float32Array(w * h);
    const coverage = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      coverage[i] = raw[i * 4 + 3] > 0.5 ? 1 : 0;
      depth[i] = coverage[i] ? linearizeDepth(1 - raw[i * 4], cam.near, cam.far) : Infinity;
    }
    return { depth, coverage };
  } finally {
    target.dispose();
  }
}

function normalPass(view, model, cam, w, h) {
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  try {
    const raw = withMaterials(model.scene, (m) => new THREE.MeshNormalMaterial({ side: m.side }), () => {
      pass(view, cam, target);
      return read(view.renderer, target, w, h, Float32Array);
    });
    const normals = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) normals[i * 3 + k] = raw[i * 4 + k] * 2 - 1;
    return normals;
  } finally {
    target.dispose();
  }
}

function colorPass(view, cam, w, h) {
  const target = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  try {
    pass(view, cam, target);
    return new Uint8ClampedArray(read(view.renderer, target, w, h, Uint8Array).buffer);
  } finally {
    target.dispose();
  }
}

const toMask = (coverage, w, h) => new Mask(w, h, coverage.map((c) => (c ? 255 : 0)));

/**
 * The export camera: the view's camera with the export frame applied.
 * view: the largest frame of the aspect inside the view. fit: a crop around the figure,
 * found on a small probe render with twice the field of view (so parts off screen count).
 */
export function exportCamera(view, model, opts) {
  view.placeCamera();
  const aspect = Aspects[opts.aspect]?.value ?? 1;
  const cam = view.camera.clone();
  if (opts.framing === 'view') {
    const vw = view.canvas.clientWidth || 1;
    const vh = view.canvas.clientHeight || 1;
    const f = frameInView(vw, vh, aspect);
    cam.aspect = vw / vh;
    cam.setViewOffset(vw, vh, f.x, f.y, f.width, f.height);
    return cam;
  }
  const probe = exportSize(256, aspect);
  cam.aspect = probe.width / probe.height;
  cam.zoom = 0.5;
  cam.updateProjectionMatrix();
  const cov = modelOnly(view, () => depthPass(view, model, cam, probe.width, probe.height).coverage);
  const crop = fitCrop(maskBBox(toMask(cov, probe.width, probe.height)), aspect, opts.margin);
  if (crop) cam.setViewOffset(probe.width, probe.height, crop.x, crop.y, crop.width, crop.height);
  return cam;
}

/** World point → output pixel, or null behind the camera. */
function projector(cam, w, h) {
  const inv = cam.matrixWorldInverse;
  return (v) => {
    if (v.clone().applyMatrix4(inv).z > -cam.near) return null;
    const p = v.clone().project(cam);
    return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h];
  };
}

/** A world-space segment, sampled so it can be clipped at the camera plane. */
function sampledLine(project, a, b, steps = 24) {
  const lines = [];
  let run = [];
  for (let i = 0; i <= steps; i++) {
    const p = project(new THREE.Vector3().lerpVectors(a, b, i / steps));
    if (p) run.push(p);
    if ((!p || i === steps) && run.length > 1) lines.push({ pts: run });
    if (!p) run = [];
  }
  return lines;
}

function floorGuides(view, cam, project, box, w) {
  const y = view.grid.position.y;
  const c = box.getCenter(new THREE.Vector3());
  const lines = [];
  const span = 1.5;
  for (let k = -span; k <= span + 1e-6; k += 0.5) {
    lines.push(...sampledLine(project, new THREE.Vector3(c.x + k, y, c.z - span), new THREE.Vector3(c.x + k, y, c.z + span)));
    lines.push(...sampledLine(project, new THREE.Vector3(c.x - span, y, c.z + k), new THREE.Vector3(c.x + span, y, c.z + k)));
  }
  // Eye level: where the horizontal view direction meets infinity.
  const fwd = cam.getWorldDirection(new THREE.Vector3());
  fwd.y = 0;
  if (fwd.lengthSq() > 1e-6) {
    const h = project(cam.position.clone().addScaledVector(fwd.normalize(), 1e4));
    if (h) lines.push({ pts: [[0, h[1]], [w, h[1]]], dash: [14, 8] });
  }
  return { lines };
}

/**
 * Renders every enabled layer. `skeleton`: { segments: [[a, b], …], head: { center, radius },
 * joints: [p, …] } in world space (from the poser).
 */
export function renderUnderdrawing(view, model, opts, skeleton, { longSide = opts.longSide } = {}) {
  const aspect = Aspects[opts.aspect]?.value ?? 1;
  const { width: w, height: h } = exportSize(longSide, aspect);
  const cam = exportCamera(view, model, opts);
  const on = opts.layers;
  const scale = longSide / opts.longSide; // previews keep the look of the full size
  const data = {};
  modelOnly(view, () => {
    if (on.shaded) data.shaded = colorPass(view, cam, w, h);
    if (on.lines || on.bbox || on.silhouette) {
      const { depth, coverage } = depthPass(view, model, cam, w, h);
      if (on.silhouette) data.silhouette = toMask(coverage, w, h);
      if (on.bbox) data.bbox = rasterizeGuides(w, h, bboxGuides(toMask(coverage, w, h)), opts.guideWidth * scale);
      if (on.lines) {
        const normals = normalPass(view, model, cam, w, h);
        data.lines = edgesFromBuffers({ w, h, depth, coverage, normals }, { radius: Math.max(0.5, (opts.lineWidth * scale) / 2) });
      }
    }
  });
  const project = projector(cam, w, h);
  const gw = opts.guideWidth * scale;
  model.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.scene, true);
  if (on.box3d && !box.isEmpty()) {
    const corners = [];
    for (let i = 0; i < 8; i++) {
      corners.push(project(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)));
    }
    data.box3d = rasterizeGuides(w, h, boxEdges(corners), gw);
  }
  if (on.floor) data.floor = rasterizeGuides(w, h, floorGuides(view, cam, project, box, w), gw * 0.75);
  if (on.skeleton && skeleton) {
    const lines = skeleton.segments.flatMap(([a, b]) => sampledLine(project, a, b, 2));
    const dots = skeleton.joints.map(project).filter(Boolean).map(([x, y]) => ({ x, y, r: gw * 1.6 }));
    const circles = [];
    const c = project(skeleton.head.center);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const edge = project(skeleton.head.center.clone().addScaledVector(right, skeleton.head.radius));
    if (c && edge) circles.push({ x: c[0], y: c[1], r: Math.hypot(edge[0] - c[0], edge[1] - c[1]) });
    data.skeleton = rasterizeGuides(w, h, { lines, circles, dots }, gw * 1.25);
  }
  return { width: w, height: h, data };
}
