import * as THREE from '../vendor/three-vrm.js';

const deg = (d) => (d * Math.PI) / 180;
const HandlePx = 9; // handle radius on screen
const PickPx = 18; // how close a click must be to grab a handle

/** Handle colours: the character's left in blue, right in orange, the trunk in green. */
const sideColor = (id) => (id.startsWith('left') ? 0x3a7bd5 : id.startsWith('right') ? 0xe0782a : id === 'look' ? 0xc040c0 : 0x2f9a5a);

export const ViewPresets = {
  front: { yaw: 0, pitch: 4 },
  side: { yaw: 90, pitch: 4 },
  back: { yaw: 180, pitch: 4 },
  top: { yaw: 0, pitch: 80 },
  angle: { yaw: 35, pitch: 15 },
};

/**
 * The editor's 3D view: the model, a floor, the skeleton as lines and the drag handles drawn on
 * top. The camera orbits a target point (yaw/pitch/distance). Rendering happens on demand.
 */
export class PoseView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe9e6df);
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0x8a8478, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-2, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.7);
    rim.position.set(3, 2, -2);
    this.scene.add(rim);
    this.grid = new THREE.GridHelper(4, 16, 0xb5b0a4, 0xd2cdc2);
    this.scene.add(this.grid);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.orbit = { target: new THREE.Vector3(0, 0.9, 0), yaw: 25, pitch: 10, dist: 4 };

    this.overlay = new THREE.Group(); // skeleton lines and handles, drawn over the model
    this.scene.add(this.overlay);
    this.boneLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.55, depthTest: false }),
    );
    this.boneLines.renderOrder = 10;
    this.overlay.add(this.boneLines);
    this.handles = new Map(); // id → { mesh, ring, pos (world) }
    this.sphere = new THREE.SphereGeometry(1, 20, 14);
    this.model = null;
    this.root = null; // the rig root (frame of the IK solver)
    this.frame = 0;
    this.showSkeleton = true;
    new ResizeObserver(() => this.requestRender()).observe(canvas);
    // After a GPU reset three.js rebuilds its resources; only a redraw is needed.
    canvas.addEventListener('webglcontextrestored', () => this.requestRender());
  }

  setModel(model, root) {
    if (this.model) this.scene.remove(this.model.scene);
    this.model = model;
    this.root = root;
    this.scene.add(model.scene);
    this.requestRender();
  }

  // ---------------------------------------------------------- rig ↔ world

  rigToWorld(v) {
    return this.root.localToWorld(new THREE.Vector3(...v));
  }

  worldToRig(w) {
    return this.root.worldToLocal(w.clone()).toArray();
  }

  /** A rotation given in world space, expressed in the rig frame (as [x, y, z, w]). */
  worldRotToRig(q) {
    const r = this.root.getWorldQuaternion(new THREE.Quaternion());
    return r.clone().invert().multiply(q).multiply(r).toArray();
  }

  // ---------------------------------------------------------- overlay

  /** Updates handles: positions (rig frame) and their look. */
  setHandles(positions, { selected = null, hover = null, pins = {} } = {}) {
    for (const [id, p] of Object.entries(positions)) {
      let h = this.handles.get(id);
      if (!h) {
        const mesh = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: sideColor(id), depthTest: false, transparent: true, opacity: 0.92 }));
        const ring = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false, transparent: true, opacity: 0.85 }));
        mesh.renderOrder = 12;
        ring.renderOrder = 11;
        this.overlay.add(ring, mesh);
        h = { mesh, ring, pos: new THREE.Vector3() };
        this.handles.set(id, h);
      }
      h.pos.copy(this.rigToWorld(p));
      h.mesh.position.copy(h.pos);
      h.ring.position.copy(h.pos);
      h.selected = id === selected;
      h.hover = id === hover;
      h.pinned = !!pins[id];
      h.ring.material.color.set(h.selected ? 0xffffff : h.pinned ? 0xb01e2a : 0x222222);
    }
    this.requestRender();
  }

  setSkeleton(lines) {
    const arr = new Float32Array(lines.length * 3);
    lines.forEach((p, i) => arr.set(this.rigToWorld(p).toArray(), i * 3));
    this.boneLines.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.boneLines.geometry.computeBoundingSphere();
    this.requestRender();
  }

  /** Keeps handles the same size on screen whatever the zoom. */
  sizeHandles() {
    const h = this.canvas.clientHeight || 1;
    const worldPerPx = (d) => (2 * d * Math.tan(deg(this.camera.fov) / 2)) / h;
    for (const hd of this.handles.values()) {
      const d = this.camera.position.distanceTo(hd.pos);
      const r = HandlePx * worldPerPx(d) * (hd.hover || hd.selected ? 1.25 : 1);
      hd.mesh.scale.setScalar(r);
      hd.ring.scale.setScalar(r * (hd.pinned || hd.selected ? 1.55 : 1.25));
    }
  }

  // ---------------------------------------------------------- camera

  placeCamera() {
    const { target, yaw, pitch, dist } = this.orbit;
    const cam = this.camera;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    cam.aspect = w / h;
    cam.position.set(
      target.x + dist * Math.sin(deg(yaw)) * Math.cos(deg(pitch)),
      target.y + dist * Math.sin(deg(pitch)),
      target.z + dist * Math.cos(deg(yaw)) * Math.cos(deg(pitch)),
    );
    cam.lookAt(target);
    cam.near = Math.max(0.01, dist / 100);
    cam.far = dist * 20 + 10;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  orbitBy(dx, dy) {
    this.orbit.yaw -= dx * 0.4;
    this.orbit.pitch = Math.max(-85, Math.min(85, this.orbit.pitch + dy * 0.3));
    this.requestRender();
  }

  panBy(dx, dy) {
    const h = this.canvas.clientHeight || 1;
    const perPx = (2 * this.orbit.dist * Math.tan(deg(this.camera.fov) / 2)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.orbit.target.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx);
    this.requestRender();
  }

  zoomBy(factor) {
    this.orbit.dist = Math.max(0.2, Math.min(30, this.orbit.dist / factor));
    this.requestRender();
  }

  setView(name) {
    const v = ViewPresets[name];
    if (!v) return;
    this.orbit.yaw = v.yaw;
    this.orbit.pitch = v.pitch;
    this.requestRender();
  }

  /** Frames the model (its bounding box now). */
  frameModel() {
    if (!this.model) return;
    this.model.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model.scene, true);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.orbit.target.copy(sphere.center);
    this.orbit.dist = (sphere.radius * 1.15) / Math.sin(deg(this.camera.fov) / 2);
    this.grid.position.set(sphere.center.x, box.min.y, sphere.center.z);
    this.requestRender();
  }

  setFloor(y) {
    this.grid.position.y = y;
    this.requestRender();
  }

  // ---------------------------------------------------------- picking

  ndc(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  toScreen(w) {
    const r = this.canvas.getBoundingClientRect();
    const p = w.clone().project(this.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, behind: p.z > 1 };
  }

  /** The handle nearest the pointer (screen distance), or null. Closer to the camera wins ties. */
  pick(clientX, clientY) {
    this.placeCamera();
    let best = null;
    for (const [id, h] of this.handles) {
      const s = this.toScreen(h.pos);
      if (s.behind) continue;
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      const depth = this.camera.position.distanceTo(h.pos);
      if (d <= PickPx && (!best || d < best.d - 3 || (Math.abs(d - best.d) <= 3 && depth < best.depth))) {
        best = { id, d, depth };
      }
    }
    return best?.id ?? null;
  }

  /** Point under the pointer on the camera-facing plane through `through` (world). */
  pointOnPlane(clientX, clientY, through) {
    this.placeCamera();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /** Screen drag (pixels) → world rotation: horizontal turns around the view's up, vertical around its right. */
  dragRotation(dx, dy) {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const qa = new THREE.Quaternion().setFromAxisAngle(up, deg(dx * 0.5));
    const qb = new THREE.Quaternion().setFromAxisAngle(right, deg(dy * 0.5));
    return qb.multiply(qa);
  }

  // ---------------------------------------------------------- drawing

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.renderer.getPixelRatio()));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.renderer.getPixelRatio()));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.placeCamera();
    this.sizeHandles();
    this.boneLines.visible = this.showSkeleton;
    this.renderer.render(this.scene, this.camera);
  }
}
