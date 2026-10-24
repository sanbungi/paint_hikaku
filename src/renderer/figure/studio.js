import * as THREE from '../vendor/three-vrm.js';
import { CanvasSize, point } from '../../engine/types.js';
import { Mask, rasterizePolyline } from '../../engine/raster.js';
import { edgesFromBuffers, linearizeDepth, overlayLines } from '../../engine/edges.js';
import { fitDistance } from '../../engine/figure.js';
import { poseById } from '../../engine/poses.js';
import { createMannequin } from './mannequin.js';

const deg = (d) => (d * Math.PI) / 180;
const Paper = [250, 249, 245];

/** Loads a .vrm (VRM 0.x or 1.0) into the same shape as the mannequin. */
export async function loadVrm(bytes) {
  const loader = new THREE.GLTFLoader();
  loader.register((parser) => new THREE.VRMLoaderPlugin(parser));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buffer, '');
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM モデルではありません');
  THREE.VRMUtils.removeUnnecessaryVertices(gltf.scene);
  THREE.VRMUtils.combineSkeletons(gltf.scene);
  THREE.VRMUtils.rotateVRM0(vrm); // VRM 0.x faces −Z; make every model face +Z
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  const meta = vrm.meta ?? {};
  return {
    scene: vrm.scene,
    humanoid: vrm.humanoid,
    update: () => vrm.update(0),
    dispose: () => THREE.VRMUtils.deepDispose(vrm.scene),
    title: meta.name ?? meta.title ?? '',
    authors: meta.authors ?? (meta.author ? [meta.author] : []),
  };
}

/** Swaps every mesh material for `make(original)` while `fn` runs. */
function withMaterials(root, make, fn) {
  const saved = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    saved.push([o, o.material]);
    o.material = Array.isArray(o.material) ? o.material.map(make) : make(o.material);
  });
  try {
    return fn();
  } finally {
    for (const [o, m] of saved) {
      const swapped = Array.isArray(o.material) ? o.material : [o.material];
      for (const s of swapped) s.dispose();
      o.material = m;
    }
  }
}

/** Keeps cut-out textures (hair cards, lashes) cut out in the data passes. */
function cutout(original) {
  const alphaTest = original.alphaTest > 0 ? original.alphaTest : (original.transparent && original.map ? 0.5 : 0);
  return { side: original.side ?? THREE.FrontSide, alphaTest, map: alphaTest ? original.map ?? null : null };
}

/**
 * Two ways to draw the same scene:
 * - renderLive(): straight to the visible canvas, cheap enough for dragging the camera;
 * - bake(): the scoring render (colour + depth + normal passes read back at 768²), done once
 *   when the user settles on a view. compose() turns a bake into template pixels and can be
 *   re-run for display options without rendering again.
 */
export class FigureStudio {
  constructor(liveCanvas, size = CanvasSize) {
    this.size = size;
    this.renderer = new THREE.WebGLRenderer({ canvas: liveCanvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0x8a8478, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    rim.position.set(3, 2, -2);
    this.scene.add(rim);
    this.grid = new THREE.GridHelper(3, 6, 0xc8c4ba, 0xdcd8ce);
    this.scene.add(this.grid);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.paper = new THREE.Color().setRGB(...Paper.map((v) => v / 255), THREE.SRGBColorSpace);

    this.colorTarget = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    this.colorTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.dataTarget = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.model = null;
    this.posed = null; // { poseId, box } of the current model
  }

  setModel(model) {
    if (this.model) {
      this.scene.remove(this.model.scene);
      this.model.dispose();
    }
    this.model = model;
    this.posed = null;
    this.scene.add(model.scene);
  }

  useMannequin() {
    this.setModel(createMannequin());
  }

  /** Poses and grounds the model; the (per-vertex, slow) bounding box is cached per pose. */
  pose(poseId) {
    if (this.posed?.poseId === poseId) return this.posed.box;
    const { humanoid, scene } = this.model;
    scene.position.set(0, 0, 0);
    humanoid.resetNormalizedPose();
    for (const [bone, [x, y, z]] of Object.entries(poseById(poseId).bones)) {
      humanoid.getNormalizedBoneNode(bone)?.quaternion.setFromEuler(new THREE.Euler(deg(x), deg(y), deg(z), 'XYZ'));
    }
    this.model.update();
    scene.updateMatrixWorld(true);
    // Stand on the floor whatever the pose (sitting, crouching).
    const box = new THREE.Box3().setFromObject(scene, true);
    scene.position.y = -box.min.y;
    scene.updateMatrixWorld(true);
    box.translate(new THREE.Vector3(0, -box.min.y, 0));
    this.posed = { poseId, box };
    return box;
  }

  /** Frames the posed figure; pan shifts the view by fractions of the half frame. */
  placeCamera(box, view) {
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius * 1.04;
    const dist = fitDistance(radius, view.fovDeg, view.zoomPct);
    const yaw = deg(view.yawDeg);
    const pitch = deg(view.pitchDeg);
    const cam = this.camera;
    cam.fov = view.fovDeg;
    cam.aspect = 1;
    cam.position.set(
      center.x + dist * Math.sin(yaw) * Math.cos(pitch),
      center.y + dist * Math.sin(pitch),
      center.z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    const half = dist * Math.tan(deg(view.fovDeg) / 2);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, (view.panX ?? 0) * half).addScaledVector(up, (view.panY ?? 0) * half);
    cam.near = Math.max(0.01, dist - radius * 2);
    cam.far = dist + radius * 2;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.grid.position.set(center.x, 0, center.z);
    return center;
  }

  /** Live preview on the visible canvas (pixel size from the layout). */
  renderLive(poseId, view, width, height) {
    if (this.renderer.domElement.width !== width || this.renderer.domElement.height !== height) {
      this.renderer.setSize(width, height, false);
    }
    this.placeCamera(this.pose(poseId), view);
    this.grid.visible = view.floorGuide;
    this.scene.background = this.paper;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  /** Reads a render target top row first. */
  read(target, Typed) {
    const n = this.size;
    const raw = new Typed(n * n * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, n, n, raw);
    const out = new Typed(n * n * 4);
    const row = n * 4;
    for (let y = 0; y < n; y++) out.set(raw.subarray((n - 1 - y) * row, (n - y) * row), y * row);
    return out;
  }

  renderPass(target, background) {
    this.scene.background = background;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  bake(poseId, view) {
    const n = this.size;
    const center = this.placeCamera(this.pose(poseId), view);
    this.grid.visible = false;
    this.renderPass(this.colorTarget, this.paper);
    const shaded = new Uint8ClampedArray(this.read(this.colorTarget, Uint8Array).buffer);
    const depthRaw = withMaterials(this.model.scene, (m) => new THREE.MeshDepthMaterial(cutout(m)), () => {
      this.renderPass(this.dataTarget, null);
      return this.read(this.dataTarget, Float32Array);
    });
    const normalRaw = withMaterials(this.model.scene, (m) => new THREE.MeshNormalMaterial({ side: m.side }), () => {
      this.renderPass(this.dataTarget, null);
      return this.read(this.dataTarget, Float32Array);
    });
    const depth = new Float32Array(n * n);
    const coverage = new Uint8Array(n * n);
    const normals = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      coverage[i] = depthRaw[i * 4 + 3] > 0.5 ? 1 : 0;
      depth[i] = coverage[i] ? linearizeDepth(1 - depthRaw[i * 4], this.camera.near, this.camera.far) : Infinity;
      for (let k = 0; k < 3; k++) normals[i * 3 + k] = normalRaw[i * 4 + k] * 2 - 1;
    }
    return { size: n, shaded, depth, coverage, normals, camera: this.camera.clone(), center };
  }

  /** Template pixels from a bake; cheap, so display options never re-render. */
  static compose(bake, view) {
    const n = bake.size;
    const ink = edgesFromBuffers(
      { w: n, h: n, depth: bake.depth, coverage: bake.coverage, normals: view.creases ? bake.normals : null },
      { radius: LineRadius },
    );
    const guides = view.floorGuide ? floorGuides(bake.camera, bake.center, n) : new Mask(n, n);
    let color = null;
    if (view.display === 'both') color = overlayLines(bake.shaded, ink);
    else if (view.display === 'shaded') color = bake.shaded;
    return { ink, guides, color };
  }
}

/** About 2.5 px wide at 768², thin enough for faces and hands. */
const LineRadius = 1.25;

/** Floor grid under the figure and the eye-level (horizon) line; never scored. */
function floorGuides(cam, center, n) {
  const g = new Mask(n, n);
  const toScreen = (v) => {
    const inCam = v.clone().applyMatrix4(cam.matrixWorldInverse);
    if (inCam.z > -cam.near) return null; // behind the camera
    const p = v.clone().project(cam);
    return point(((p.x + 1) / 2) * n, ((1 - p.y) / 2) * n);
  };
  const polyline = (a, b) => {
    let run = [];
    for (let i = 0; i <= 32; i++) {
      const p = toScreen(new THREE.Vector3().lerpVectors(a, b, i / 32));
      if (p) run.push(p);
      if ((!p || i === 32) && run.length > 1) rasterizePolyline(g, run, 1.5);
      if (!p) run = [];
    }
  };
  const span = 1.5;
  for (let k = -span; k <= span + 1e-6; k += 0.5) {
    polyline(new THREE.Vector3(center.x + k, 0, center.z - span), new THREE.Vector3(center.x + k, 0, center.z + span));
    polyline(new THREE.Vector3(center.x - span, 0, center.z + k), new THREE.Vector3(center.x + span, 0, center.z + k));
  }
  const forward = new THREE.Vector3();
  cam.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() > 1e-6) {
    const far = cam.position.clone().addScaledVector(forward.normalize(), 1e4);
    const h = toScreen(far);
    if (h && h.y >= 0 && h.y < n) rasterizePolyline(g, [point(0, h.y), point(n - 1, h.y)], 1.5);
  }
  return g;
}
