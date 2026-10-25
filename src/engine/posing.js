import {
  Limbs, add, aimChain, bonesToPose, clonePose, dist, fk, mirrorPose, norm, pointOf, poseToBones, qfromEuler,
  qmul, qrot, qtoEuler, restPose, scale, setWorldRot, solveChain, solveLimb, sub,
} from './ik.js';

/**
 * Drag handles of the full-body poser. Positions are in the rig frame.
 * Dragging a hand or foot is limb IK; an elbow or knee swings the limb's bend plane (the
 * hand/foot stays); the hips move the whole body over pinned feet; chest and head bend the
 * spine and neck; the gaze point turns the head.
 */
export const Handles = [
  { id: 'head', labelJa: '頭' },
  { id: 'look', labelJa: '視線' },
  { id: 'chest', labelJa: '胸' },
  { id: 'hips', labelJa: '腰' },
  { id: 'leftHand', labelJa: '左手', limb: 'leftArm', part: 'end' },
  { id: 'rightHand', labelJa: '右手', limb: 'rightArm', part: 'end' },
  { id: 'leftElbow', labelJa: '左ひじ', limb: 'leftArm', part: 'mid' },
  { id: 'rightElbow', labelJa: '右ひじ', limb: 'rightArm', part: 'mid' },
  { id: 'leftKnee', labelJa: '左ひざ', limb: 'leftLeg', part: 'mid' },
  { id: 'rightKnee', labelJa: '右ひざ', limb: 'rightLeg', part: 'mid' },
  { id: 'leftFoot', labelJa: '左足', limb: 'leftLeg', part: 'end' },
  { id: 'rightFoot', labelJa: '右足', limb: 'rightLeg', part: 'end' },
];

export const handleById = (id) => Handles.find((h) => h.id === id) ?? null;

/** Hands and feet can be pinned: they stay where they are while the rest of the body moves. */
export const PinnableHandles = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];

const pinLimb = { leftHand: 'leftArm', rightHand: 'rightArm', leftFoot: 'leftLeg', rightFoot: 'rightLeg' };

/** Bone that a Shift-drag (rotation) on a handle turns. */
const RotateBone = {
  head: 'head', look: 'head', chest: 'chest', hips: 'hips',
  leftHand: 'leftHand', rightHand: 'rightHand', leftFoot: 'leftFoot', rightFoot: 'rightFoot',
  leftElbow: 'leftUpperArm', rightElbow: 'rightUpperArm', leftKnee: 'leftUpperLeg', rightKnee: 'rightUpperLeg',
};

const UndoLimit = 100;

export class PoseRig {
  /** `floorY`: the floor height in the rig frame at rest (the model's lowest point). */
  constructor(skel, { floorY = null } = {}) {
    this.skel = skel;
    this.pose = restPose(skel);
    this.pins = { leftHand: false, rightHand: false, leftFoot: true, rightFoot: true };
    this.reachAssist = true; // a hand out of reach bends the spine and shoulder toward it
    this.autoGround = true;
    const r = skel.restPos;
    const H = skel.height;
    this.floorY = floorY ?? Math.min(r.leftFoot[1], r.rightFoot[1]) - 0.05 * H;
    // How far above the floor each joint stays (feet: their rest height).
    this.clearance = {};
    for (const n of skel.names) this.clearance[n] = 0.03 * H;
    for (const n of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes']) {
      if (r[n]) this.clearance[n] = Math.max(0.005 * H, r[n][1] - this.floorY);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
    this.ground();
  }

  get H() {
    return this.skel.height;
  }

  fk() {
    return fk(this.skel, this.pose);
  }

  /** Head centre: a little above the head bone (the base of the skull). */
  headPoint(f) {
    return pointOf(f, { bone: 'head', offset: [0, 0.06 * this.H, 0] });
  }

  chestBone() {
    return this.skel.rest.neck ? 'neck' : 'head';
  }

  /** Handle positions (rig frame). */
  handlePositions(f = this.fk()) {
    const out = {};
    const head = this.headPoint(f);
    out.head = head;
    out.look = add(head, qrot(f.rot.head, scale(this.skel.forward, 0.22 * this.H)));
    out.chest = f.pos[this.chestBone()];
    out.hips = f.pos.hips;
    for (const h of Handles) {
      if (!h.limb) continue;
      const limb = Limbs[h.limb];
      out[h.id] = f.pos[h.part === 'end' ? limb.end : limb.lower];
    }
    return out;
  }

  // ---------------------------------------------------------- undo

  snapshot() {
    return clonePose(this.pose);
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UndoLimit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.pose = this.undoStack.pop();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.pose = this.redoStack.pop();
    return true;
  }

  // ---------------------------------------------------------- dragging

  /** Starts a drag; every drag() step is solved again from this starting pose (no drift). */
  beginDrag(id) {
    this.pushUndo();
    const f = this.fk();
    const ends = {};
    for (const [hid, limbKey] of Object.entries(pinLimb)) {
      const end = Limbs[limbKey].end;
      ends[hid] = { pos: f.pos[end], rot: f.rot[end] };
    }
    this.drag = { id, start: this.snapshot(), startF: f, handle: this.handlePositions(f)[id], ends };
  }

  /** Moves handle `id` to `target` (rig frame). */
  dragTo(target) {
    const d = this.drag;
    if (!d) return;
    const skel = this.skel;
    this.pose = clonePose(d.start);
    const h = handleById(d.id);
    let skip = null;
    if (d.id === 'hips') {
      this.pose.hips = add(d.start.hips, sub(target, d.handle));
    } else if (d.id === 'chest') {
      solveChain(skel, this.pose, [
        { bone: 'spine', weight: 0.5, limitDeg: 40 },
        { bone: 'chest', weight: 0.5, limitDeg: 35 },
        { bone: 'upperChest', weight: 0.5, limitDeg: 30 },
      ], { bone: this.chestBone() }, target);
    } else if (d.id === 'head') {
      const headWorld = d.startF.rot.head;
      solveChain(skel, this.pose, [
        { bone: 'spine', weight: 0.2, limitDeg: 25 },
        { bone: 'chest', weight: 0.25, limitDeg: 25 },
        { bone: 'upperChest', weight: 0.25, limitDeg: 20 },
        { bone: 'neck', weight: 0.8, limitDeg: 55 },
      ], { bone: 'head', offset: [0, 0.06 * this.H, 0] }, target);
      // The face keeps looking the same way while the neck carries the head.
      const f = this.fk();
      setWorldRot(skel, this.pose, f, 'head', headWorld);
    } else if (d.id === 'look') {
      aimChain(skel, this.pose, [
        { bone: 'neck', weight: 0.35, limitDeg: 45 },
        { bone: 'head', weight: 1, limitDeg: 75 },
      ], 'head', skel.forward, target);
    } else if (h?.limb) {
      skip = h.limb;
      const limb = Limbs[h.limb];
      const endKey = h.limb.replace('Arm', 'Hand').replace('Leg', 'Foot');
      const end = d.ends[endKey];
      if (h.part === 'end') {
        if (limb.upper.includes('Arm') && this.reachAssist) this.reachToward(h.limb, target);
        solveLimb(skel, this.pose, h.limb, target, { endRot: end.rot });
      } else {
        const A = d.startF.pos[limb.upper];
        solveLimb(skel, this.pose, h.limb, end.pos, { pole: sub(target, A), endRot: end.rot });
      }
    }
    this.satisfyPins(skip);
  }

  /** Shift-drag: turns the handle's bone by `delta` (a rig-frame rotation) from the drag start. */
  rotateBy(delta) {
    const d = this.drag;
    if (!d) return;
    this.pose = clonePose(d.start);
    const bone = this.skel.rest[RotateBone[d.id]] ? RotateBone[d.id] : 'spine';
    const f = fk(this.skel, this.pose);
    setWorldRot(this.skel, this.pose, f, bone, qmul(delta, f.rot[bone]));
    const h = handleById(d.id);
    this.satisfyPins(h?.limb ?? null);
  }

  endDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.ground();
  }

  /** A hand pulled beyond the arm's reach bends the spine and shoulder toward the target. */
  reachToward(limbKey, target) {
    const skel = this.skel;
    const limb = skel.limbs[limbKey];
    const f = this.fk();
    const S = f.pos[limb.upper];
    const far = dist(target, S);
    if (far <= limb.reach * 0.98) return;
    const side = limbKey.startsWith('left') ? 'left' : 'right';
    const goal = sub(target, scale(norm(sub(target, S)), limb.reach * 0.97));
    solveChain(skel, this.pose, [
      { bone: 'spine', weight: 0.3, limitDeg: 25 },
      { bone: 'chest', weight: 0.3, limitDeg: 25 },
      { bone: 'upperChest', weight: 0.3, limitDeg: 20 },
      { bone: `${side}Shoulder`, weight: 0.6, limitDeg: 30 },
    ], { bone: limb.upper }, goal, 8);
  }

  /** Pinned hands and feet go back to where they were when the drag started. */
  satisfyPins(skipLimb) {
    const ends = this.drag?.ends;
    if (!ends) return;
    for (const [hid, on] of Object.entries(this.pins)) {
      const limbKey = pinLimb[hid];
      if (!on || limbKey === skipLimb) continue;
      solveLimb(this.skel, this.pose, limbKey, ends[hid].pos, { endRot: ends[hid].rot });
    }
  }

  /** Keeps the lowest joint on the floor (feet keep their sole height). */
  ground() {
    if (!this.autoGround) return;
    const f = this.fk();
    let low = Infinity;
    for (const n of this.skel.names) low = Math.min(low, f.pos[n][1] - this.clearance[n]);
    this.pose.hips[1] += this.floorY - low;
  }

  // ---------------------------------------------------------- whole-pose edits

  /** Local rotation of one bone as Euler XYZ degrees (for the fine-tuning sliders). */
  boneEuler(bone) {
    return qtoEuler(this.pose.rot[bone]);
  }

  setBoneEuler(bone, euler) {
    if (!this.skel.rest[bone]) return;
    this.pose.rot[bone] = qfromEuler(euler);
    this.ground();
  }

  /** Loads { bones, hips? } (built-in or saved poses). */
  load(pose) {
    this.pushUndo();
    this.pose = bonesToPose(this.skel, pose.bones);
    if (Array.isArray(pose.hips)) this.pose.hips = [...pose.hips];
    this.ground();
  }

  setPose(pose) {
    this.pushUndo();
    this.pose = clonePose(pose);
    this.ground();
  }

  reset() {
    this.pushUndo();
    this.pose = restPose(this.skel);
    this.ground();
  }

  mirror() {
    this.pushUndo();
    this.pose = mirrorPose(this.skel, this.pose);
    this.ground();
  }

  /** Blends the current pose toward its mirror image on one side (symmetry from left/right). */
  copySide(from) {
    this.pushUndo();
    const m = mirrorPose(this.skel, this.pose);
    const to = from === 'left' ? 'right' : 'left';
    for (const n of this.skel.names) if (n.startsWith(to)) this.pose.rot[n] = m.rot[n];
    this.ground();
  }

  /** Saved form: rotations like the built-in poses, plus the hips offset for re-editing. */
  toPoseData() {
    return { bones: poseToBones(this.skel, this.pose), hips: this.pose.hips.map((v) => Math.round(v * 1e4) / 1e4) };
  }
}
