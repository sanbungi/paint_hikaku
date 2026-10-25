// Full-body IK poser and photo → pose fitting (pure math, no three.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Skeleton, add, bonesToPose, dist, dot, fk, mirrorPose, norm, poseToBones, qangle, qconj, qfromEuler, qmul,
  qrot, qtoEuler, restPose, scale, solveLimb, sub,
} from '../../src/engine/ik.js';
import { Handles, PoseRig } from '../../src/engine/posing.js';
import { Landmark, fitLandmarks } from '../../src/engine/posefit.js';
import { Poses, poseById } from '../../src/engine/poses.js';

/** The mannequin's rig (src/renderer/figure/mannequin.js), as parent + offset. */
const MannequinRig = [
  ['hips', null, [0, 0.93, 0]], ['spine', 'hips', [0, 0.08, 0]], ['chest', 'spine', [0, 0.14, 0]],
  ['neck', 'chest', [0, 0.24, 0]], ['head', 'neck', [0, 0.09, 0]],
  ['leftShoulder', 'chest', [0.03, 0.2, 0]], ['leftUpperArm', 'leftShoulder', [0.13, 0, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.27, 0, 0]], ['leftHand', 'leftLowerArm', [0.24, 0, 0]],
  ['rightShoulder', 'chest', [-0.03, 0.2, 0]], ['rightUpperArm', 'rightShoulder', [-0.13, 0, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.27, 0, 0]], ['rightHand', 'rightLowerArm', [-0.24, 0, 0]],
  ['leftUpperLeg', 'hips', [0.09, -0.04, 0]], ['leftLowerLeg', 'leftUpperLeg', [0, -0.42, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.4, 0]],
  ['rightUpperLeg', 'hips', [-0.09, -0.04, 0]], ['rightLowerLeg', 'rightUpperLeg', [0, -0.42, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.4, 0]],
];

/** A shorter, stockier figure without shoulders but with an upper chest (like many VRMs). */
const ChibiRig = [
  ['hips', null, [0, 0.6, 0]], ['spine', 'hips', [0, 0.06, 0]], ['chest', 'spine', [0, 0.08, 0]],
  ['upperChest', 'chest', [0, 0.08, 0]], ['neck', 'upperChest', [0, 0.1, 0]], ['head', 'neck', [0, 0.06, 0]],
  ['leftUpperArm', 'upperChest', [0.12, 0.06, 0]], ['leftLowerArm', 'leftUpperArm', [0.16, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.14, 0, 0]],
  ['rightUpperArm', 'upperChest', [-0.12, 0.06, 0]], ['rightLowerArm', 'rightUpperArm', [-0.16, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.14, 0, 0]],
  ['leftUpperLeg', 'hips', [0.08, -0.03, 0]], ['leftLowerLeg', 'leftUpperLeg', [0, -0.27, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.25, 0]],
  ['rightUpperLeg', 'hips', [-0.08, -0.03, 0]], ['rightLowerLeg', 'rightUpperLeg', [0, -0.27, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.25, 0]],
];

const skeletonOf = (rig) => new Skeleton(Object.fromEntries(rig.map(([n, parent, offset]) => [n, { parent, offset }])));
const angleBetween = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;
const near = (a, b, eps, msg) => assert.ok(dist(a, b) < eps, `${msg}: ${a.map((v) => v.toFixed(3))} vs ${b.map((v) => v.toFixed(3))}`);

test('IK-MATH: Euler XYZ ↔ quaternion matches three.js conventions and round-trips', () => {
  // three.js: Euler(90°, 0, 0) turns +Y to +Z.
  near(qrot(qfromEuler([90, 0, 0]), [0, 1, 0]), [0, 0, 1], 1e-9, 'x rotation');
  near(qrot(qfromEuler([0, 0, 90]), [1, 0, 0]), [0, 1, 0], 1e-9, 'z rotation');
  for (const e of [[10, -20, 30], [-80, 45, 170], [0, 89, 0], [33, -5, -120]]) {
    const back = qtoEuler(qfromEuler(e));
    assert.ok(qangle(qmul(qconj(qfromEuler(e)), qfromEuler(back))) < 1e-6, `${e} → ${back}`);
  }
  const skel = skeletonOf(MannequinRig);
  for (const p of Poses) {
    const again = poseToBones(skel, bonesToPose(skel, p.bones));
    for (const [bone, e] of Object.entries(p.bones)) {
      assert.ok(qangle(qmul(qconj(qfromEuler(e)), qfromEuler(again[bone]))) < 0.2 * Math.PI / 180, `${p.id}.${bone}`);
    }
  }
});

test('IK-LIMB: two-bone IK reaches the target and bends knees forward, elbows back', () => {
  for (const rig of [MannequinRig, ChibiRig]) {
    const skel = skeletonOf(rig);
    assert.deepEqual(skel.left.map(Math.round), [1, 0, 0]);
    assert.deepEqual(skel.forward.map(Math.round), [0, 0, 1]);
    const pose = restPose(skel);
    const f0 = fk(skel, pose);
    // Lift the foot forward and up: the knee must come forward (+Z) and the foot land exactly.
    const footTarget = add(f0.pos.leftFoot, [0, skel.limbs.leftLeg.reach * 0.4, skel.limbs.leftLeg.reach * 0.3]);
    solveLimb(skel, pose, 'leftLeg', footTarget);
    let f = fk(skel, pose);
    near(f.pos.leftFoot, footTarget, 1e-6, 'foot reaches');
    const kneeOff = sub(f.pos.leftLowerLeg, f.pos.leftUpperLeg);
    assert.ok(kneeOff[2] > 0.05 * skel.height, 'knee points forward');
    assert.ok(qangle(f.rot.leftFoot) < 1e-6, 'the foot keeps its world rotation');
    // Bring the right hand to the chest: the elbow stays behind/outside, not through the body.
    const handTarget = add(f.pos.chest, [0, 0.1 * skel.height, 0.15 * skel.height]);
    solveLimb(skel, pose, 'rightArm', handTarget);
    f = fk(skel, pose);
    near(f.pos.rightHand, handTarget, 1e-6, 'hand reaches');
    assert.ok(f.pos.rightLowerArm[2] < handTarget[2], 'elbow behind the hand');
    // Out of reach: the limb straightens toward the target.
    const far = add(f.pos.leftUpperArm, [2, 0, 0]);
    solveLimb(skel, pose, 'leftArm', far);
    f = fk(skel, pose);
    assert.ok(angleBetween(sub(f.pos.leftHand, f.pos.leftUpperArm), [1, 0, 0]) < 1, 'points at the target');
    assert.ok(Math.abs(dist(f.pos.leftHand, f.pos.leftUpperArm) - skel.limbs.leftArm.reach) < 1e-6, 'fully stretched');
    // The pole chooses the bend plane: knee to the side.
    solveLimb(skel, pose, 'rightLeg', add(f0.pos.rightFoot, [0, 0.3, 0]), { pole: [-1, 0, 0] });
    f = fk(skel, pose);
    assert.ok(f.pos.rightLowerLeg[0] < f.pos.rightUpperLeg[0] - 0.05, 'knee opens outward');
  }
});

test('IK-FULLBODY: dragging the hips down crouches over pinned feet, then grounds', () => {
  const skel = skeletonOf(MannequinRig);
  const rig = new PoseRig(skel, { floorY: 0 });
  const f0 = rig.fk();
  const feet0 = [f0.pos.leftFoot, f0.pos.rightFoot];
  const hips0 = rig.handlePositions().hips;
  rig.beginDrag('hips');
  rig.dragTo(add(hips0, [0, -0.3, -0.05]));
  let f = rig.fk();
  near(f.pos.leftFoot, feet0[0], 1e-6, 'left foot pinned');
  near(f.pos.rightFoot, feet0[1], 1e-6, 'right foot pinned');
  assert.ok(f.pos.hips[1] < hips0[1] - 0.29, 'hips went down');
  for (const s of ['left', 'right']) {
    assert.ok(f.pos[`${s}LowerLeg`][2] > f.pos[`${s}UpperLeg`][2] + 0.1, `${s} knee bends forward`);
    assert.ok(qangle(f.rot[`${s}Foot`]) < 1e-6, `${s} foot stays flat`);
  }
  rig.endDrag();
  f = rig.fk();
  near(f.pos.leftFoot, feet0[0], 1e-6, 'grounding keeps planted feet');
  // Undo goes back to standing.
  assert.ok(rig.undo());
  near(rig.fk().pos.hips, f0.pos.hips, 1e-9, 'undo');
  assert.ok(rig.redo());
  near(rig.fk().pos.hips, f.pos.hips, 1e-9, 'redo');

  // Pulling the hips up past the legs' reach lifts the feet; grounding puts them back down.
  rig.beginDrag('hips');
  rig.dragTo(add(rig.handlePositions().hips, [0, 0.5, 0]));
  rig.endDrag();
  f = rig.fk();
  assert.ok(Math.abs(Math.min(f.pos.leftFoot[1], f.pos.rightFoot[1]) - rig.clearance.leftFoot) < 1e-6, 'feet on the floor');
});

test('IK-HANDLES: hands, elbows, knees, chest, head and gaze move what they should', () => {
  const skel = skeletonOf(ChibiRig);
  const rig = new PoseRig(skel);
  const h0 = rig.handlePositions();
  assert.deepEqual(Object.keys(h0).sort(), Handles.map((h) => h.id).sort());

  // Hand: reaches, the other limbs don't move.
  const target = add(h0.leftHand, [-0.15, 0.1, 0.12]);
  rig.beginDrag('leftHand');
  rig.dragTo(target);
  rig.endDrag();
  let h = rig.handlePositions();
  near(h.leftHand, target, 1e-6, 'hand');
  near(h.rightHand, h0.rightHand, 1e-9, 'other hand untouched');

  // Elbow: swings the bend plane, the hand stays.
  rig.beginDrag('leftElbow');
  rig.dragTo(add(h.leftElbow, [0, -0.2, 0]));
  rig.endDrag();
  const h2 = rig.handlePositions();
  near(h2.leftHand, h.leftHand, 1e-6, 'hand stays while the elbow moves');
  assert.ok(h2.leftElbow[1] < h.leftElbow[1] - 0.01, 'elbow went down');

  // A pinned hand stays while the chest bends.
  rig.pins.leftHand = true;
  rig.beginDrag('chest');
  rig.dragTo(add(h2.chest, [0, -0.05, 0.12]));
  rig.endDrag();
  const h3 = rig.handlePositions();
  near(h3.leftHand, h2.leftHand, 1e-6, 'pinned hand');
  assert.ok(h3.chest[2] > h2.chest[2] + 0.05, 'chest leaned forward');
  assert.ok(dist(h3.rightHand, h2.rightHand) > 0.02, 'free hand follows the body');

  // Reach assist: a hand far away pulls the shoulder along.
  rig.pins.leftHand = false;
  const s0 = rig.fk().pos.rightUpperArm;
  rig.beginDrag('rightHand');
  const far = add(s0, [-0.6, 0, 0.2]);
  rig.dragTo(far);
  rig.endDrag();
  assert.ok(dist(rig.fk().pos.rightUpperArm, far) < dist(s0, far) - 0.02, 'shoulder moved toward the target');

  // Knee pole drag: the foot stays planted.
  const footBefore = rig.handlePositions().rightFoot;
  rig.beginDrag('rightKnee');
  rig.dragTo(add(rig.handlePositions().rightKnee, [-0.2, 0, 0.1]));
  rig.endDrag();
  near(rig.handlePositions().rightFoot, footBefore, 1e-3, 'foot stays (pinned)');

  // Head: the neck carries it, the face keeps its direction.
  const r0 = rig.fk();
  rig.beginDrag('head');
  rig.dragTo(add(rig.handlePositions().head, [0.04, -0.02, 0.05]));
  rig.endDrag();
  const r1 = rig.fk();
  assert.ok(qangle(r1.rot.neck) > 0.05, 'neck bends');
  assert.ok(qangle(qmul(qconj(r0.rot.head), r1.rot.head)) < 0.02, 'face direction kept');

  // Gaze: the face turns toward the point.
  const look = rig.handlePositions().look;
  rig.beginDrag('look');
  rig.dragTo(add(look, [0.3, 0, 0]));
  rig.endDrag();
  const fwd = qrot(rig.fk().rot.head, skel.forward);
  assert.ok(fwd[0] > 0.3, `turned to the left side (${fwd})`);

  // Shift-drag rotation of the hips keeps pinned feet.
  const feet = [rig.handlePositions().leftFoot, rig.handlePositions().rightFoot];
  rig.beginDrag('hips');
  rig.rotateBy(qfromEuler([0, 25, 0]));
  rig.endDrag();
  near(rig.handlePositions().leftFoot, feet[0], 1e-3, 'left foot pinned through hip turn');
});

test('IK-MIRROR: mirroring swaps sides and twice is identity', () => {
  const skel = skeletonOf(MannequinRig);
  const pose = bonesToPose(skel, poseById('contrapposto').bones);
  const m = mirrorPose(skel, pose);
  const mb = poseToBones(skel, m);
  const [x, y, z] = poseById('contrapposto').bones.rightUpperArm;
  const ml = mb.leftUpperArm;
  assert.ok(Math.abs(ml[0] - x) < 0.2 && Math.abs(ml[1] + y) < 0.2 && Math.abs(ml[2] + z) < 0.2, `${ml}`);
  const back = mirrorPose(skel, m);
  for (const n of skel.names) assert.ok(qangle(qmul(qconj(pose.rot[n]), back.rot[n])) < 1e-6, n);
  // Positions mirror too.
  const a = fk(skel, pose);
  const b = fk(skel, m);
  near(b.pos.leftHand, [-a.pos.rightHand[0], a.pos.rightHand[1], a.pos.rightHand[2]], 1e-6, 'hand positions');
});

/** Fake MediaPipe world landmarks from a posed skeleton. */
function landmarksOf(skel, pose) {
  const f = fk(skel, pose);
  const pts = Array.from({ length: 33 }, () => [0, 0, 0]);
  const I = Landmark;
  const H = skel.height;
  const at = (bone, off) => add(f.pos[bone], qrot(f.rot[bone], scale(off, H)));
  pts[I.leftEar] = at('head', [0.04, 0.035, 0]);
  pts[I.rightEar] = at('head', [-0.04, 0.035, 0]);
  pts[I.nose] = at('head', [0, 0.035 - 0.06 * Math.tan((15 * Math.PI) / 180), 0.06]);
  for (const s of ['left', 'right']) {
    const sx = s === 'left' ? 1 : -1;
    const c = (n) => `${s}${n}`;
    pts[I[c('Shoulder')]] = f.pos[c('UpperArm')];
    pts[I[c('Elbow')]] = f.pos[c('LowerArm')];
    pts[I[c('Wrist')]] = f.pos[c('Hand')];
    pts[I[c('Index')]] = at(c('Hand'), [sx * 0.05, 0, 0.02]);
    pts[I[c('Pinky')]] = at(c('Hand'), [sx * 0.05, 0, -0.02]);
    pts[I[c('Hip')]] = f.pos[c('UpperLeg')];
    pts[I[c('Knee')]] = f.pos[c('LowerLeg')];
    pts[I[c('Ankle')]] = f.pos[c('Foot')];
    pts[I[c('Heel')]] = at(c('Foot'), [0, -0.03, -0.03]);
    pts[I[c('FootIndex')]] = at(c('Foot'), [0, -0.035, 0.09]);
  }
  const hipMid = scale(add(pts[I.leftHip], pts[I.rightHip]), 0.5);
  // Rig frame (left +X, up +Y, forward +Z) → MediaPipe (x right in the image, y down, z away).
  return pts.map((p) => {
    const v = sub(p, hipMid);
    return { x: v[0], y: -v[1], z: -v[2], visibility: 0.99 };
  });
}

const Segments = [
  ['leftUpperArm', 'leftLowerArm'], ['leftLowerArm', 'leftHand'], ['rightUpperArm', 'rightLowerArm'],
  ['rightLowerArm', 'rightHand'], ['leftUpperLeg', 'leftLowerLeg'], ['leftLowerLeg', 'leftFoot'],
  ['rightUpperLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot'],
];

test('POSEFIT: landmarks of a known pose give back the same limb directions, on any proportions', () => {
  const src = skeletonOf(MannequinRig);
  for (const dst of [skeletonOf(MannequinRig), skeletonOf(ChibiRig)]) {
    for (const id of ['walk', 'run', 'think', 'reach', 'crouch', 'contrapposto']) {
      const truth = bonesToPose(src, poseById(id).bones);
      const { pose, missing } = fitLandmarks(dst, landmarksOf(src, truth));
      assert.deepEqual(missing, []);
      const a = fk(src, truth);
      const b = fk(dst, pose);
      for (const [p, c] of Segments) {
        const err = angleBetween(sub(a.pos[c], a.pos[p]), sub(b.pos[c], b.pos[p]));
        assert.ok(err < 4, `${id} ${p}→${c}: ${err.toFixed(1)}°`);
      }
      // Face and hand directions.
      const faceErr = angleBetween(qrot(a.rot.head, src.forward), qrot(b.rot.head, dst.forward));
      assert.ok(faceErr < 6, `${id} face ${faceErr.toFixed(1)}°`);
      for (const hand of ['leftHand', 'rightHand']) {
        const e = angleBetween(qrot(a.rot[hand], [0, 1, 0]), qrot(b.rot[hand], [0, 1, 0]));
        assert.ok(e < 8, `${id} ${hand} back ${e.toFixed(1)}°`);
      }
      const footErr = angleBetween(qrot(a.rot.leftFoot, [0, 0, 1]), qrot(b.rot.leftFoot, [0, 0, 1]));
      assert.ok(footErr < 6, `${id} foot ${footErr.toFixed(1)}°`);
    }
  }
});

test('POSEFIT: unseen limbs stay neutral, mirror swaps sides', () => {
  const skel = skeletonOf(MannequinRig);
  const truth = bonesToPose(skel, poseById('reach').bones);
  const lm = landmarksOf(skel, truth);
  for (const i of [Landmark.leftKnee, Landmark.leftAnkle]) lm[i].visibility = 0.05;
  const { pose, missing } = fitLandmarks(skel, lm);
  assert.deepEqual(missing, ['左脚']);
  assert.ok(qangle(pose.rot.leftLowerLeg) < 1e-9, 'unseen leg stays straight');
  const plain = fitLandmarks(skel, landmarksOf(skel, truth)).pose;
  const mirrored = fitLandmarks(skel, landmarksOf(skel, truth), { mirror: true }).pose;
  const a = fk(skel, plain);
  const b = fk(skel, mirrored);
  near(b.pos.leftHand, [-a.pos.rightHand[0], a.pos.rightHand[1], a.pos.rightHand[2]], 1e-6, 'mirrored');
  assert.throws(() => fitLandmarks(skel, []), /ランドマーク/);
});
