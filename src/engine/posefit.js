import {
  add, cross, dot, fk, len, mirrorPose, norm, perp, qaxis, qconj, qfromPairs, qid, qmul, qpow, qrot, restPose,
  scale, solveLimb, sub,
} from './ik.js';

/** MediaPipe Pose (BlazePose, 33 points) landmark indices. */
export const Landmark = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
};

const Deg = Math.PI / 180;
const mid = (a, b) => scale(add(a, b), 0.5);

/**
 * Turns MediaPipe *world* landmarks (metres, origin between the hips, x to the image right,
 * y down, z away from the camera) into a pose for `skel`.
 *
 * Instead of converting each landmark pair to an Euler angle (as Kalidokit does), the
 * landmarks become IK targets: bone directions come from the photo, bone lengths from the
 * model, and the knee/elbow bend planes from the middle joints. This keeps the result valid
 * for any body proportions. Parts the detector did not see stay in a neutral pose.
 *
 * Returns { pose, missing: [part names] }.
 */
export function fitLandmarks(skel, landmarks, { mirror = false, minVisibility = 0.35 } = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) throw new Error('ランドマークが足りません');
  const { left: L, up: U, forward: F } = skel;
  // Camera view → rig frame: the person faces the camera, like the model faces +Z.
  const P = landmarks.map((p) => {
    const v = [p.x, -p.y, -p.z];
    return add(add(scale(L, v[0]), scale(U, v[1])), scale(F, v[2]));
  });
  const seen = (...ids) => ids.every((i) => (landmarks[i].visibility ?? 1) >= minVisibility);
  const I = Landmark;
  const pose = restPose(skel);
  const missing = [];

  // Torso: the hips take the pelvis line and half the lean; the spine bones share the rest.
  const pelvisLeft = norm(sub(P[I.leftHip], P[I.rightHip]), L);
  const shoulderLeft = norm(sub(P[I.leftShoulder], P[I.rightShoulder]), pelvisLeft);
  const torsoUp = norm(sub(mid(P[I.leftShoulder], P[I.rightShoulder]), mid(P[I.leftHip], P[I.rightHip])), U);
  const hipsWorld = qfromPairs(L, U, pelvisLeft, norm(add(U, torsoUp), torsoUp));
  const chestWorld = qfromPairs(L, U, shoulderLeft, torsoUp);
  pose.rot.hips = hipsWorld;
  const spine = ['spine', 'chest', 'upperChest'].filter((b) => skel.rest[b]);
  const bend = qmul(qconj(hipsWorld), chestWorld);
  for (const b of spine) pose.rot[b] = qpow(bend, 1 / spine.length);

  // Head from the ears and the nose (the nose sits a little below the ear line).
  if (seen(I.leftEar, I.rightEar, I.nose)) {
    const headLeft = norm(sub(P[I.leftEar], P[I.rightEar]), shoulderLeft);
    let fwd = norm(perp(sub(P[I.nose], mid(P[I.leftEar], P[I.rightEar])), headLeft), F);
    fwd = qrot(qaxis(headLeft, -15 * Deg), fwd);
    const headWorld = qfromPairs(L, F, headLeft, fwd);
    const f = fk(skel, pose);
    const parent = skel.rest.neck ? f.rot[skel.rest.neck.parent] : f.rot[skel.rest.head.parent];
    const turn = qmul(qconj(parent), headWorld);
    if (skel.rest.neck) {
      pose.rot.neck = qpow(turn, 0.4);
      pose.rot.head = qpow(turn, 0.6);
    } else {
      pose.rot.head = turn;
    }
  } else {
    missing.push('頭');
  }

  const limb = (key, root, middle, end, label) => {
    const l = skel.limbs[key];
    const f = fk(skel, pose);
    const A = f.pos[l.upper];
    if (!seen(root, middle, end)) {
      missing.push(label);
      if (l.kind === 'arm') solveLimb(skel, pose, key, add(A, scale(U, -l.reach * 0.97)), { pole: scale(F, -1), endRot: null });
      return false;
    }
    const s = P[root];
    const e = P[middle];
    const w = P[end];
    const ratio = Math.min(1, len(sub(w, s)) / (len(sub(e, s)) + len(sub(w, e)) || 1));
    const target = add(A, scale(norm(sub(w, s), scale(U, -1)), l.reach * ratio));
    solveLimb(skel, pose, key, target, { pole: sub(e, s) });
    return true;
  };

  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 'left' : 'right';
    const cap = (n) => `${s}${n}`;
    const armOk = limb(`${s}Arm`, I[cap('Shoulder')], I[cap('Elbow')], I[cap('Wrist')], side === 'left' ? '左腕' : '右腕');
    const hand = cap('Hand');
    const lower = cap('LowerArm');
    let f = fk(skel, pose);
    // Hands: direction to the knuckles, back of the hand from the index/pinky spread.
    if (armOk && seen(I[cap('Index')], I[cap('Pinky')])) {
      const w = P[I[cap('Wrist')]];
      const a = sub(P[I[cap('Index')]], w);
      const b = sub(P[I[cap('Pinky')]], w);
      const dir = norm(add(a, b));
      const back = side === 'left' ? cross(a, b) : cross(b, a);
      const restDir = norm(skel.rest[hand].offset);
      const handWorld = qfromPairs(restDir, U, dir, back);
      pose.rot[hand] = qmul(qconj(f.rot[lower]), handWorld);
    } else {
      pose.rot[hand] = qid();
    }
    const legOk = limb(`${s}Leg`, I[cap('Hip')], I[cap('Knee')], I[cap('Ankle')], side === 'left' ? '左脚' : '右脚');
    f = fk(skel, pose);
    const foot = cap('Foot');
    if (legOk && seen(I[cap('Heel')], I[cap('FootIndex')])) {
      const toes = norm(sub(P[I[cap('FootIndex')]], P[I[cap('Heel')]]), F);
      const shin = norm(sub(P[I[cap('Knee')]], P[I[cap('Ankle')]]), U);
      const footWorld = qfromPairs(F, U, toes, dot(toes, shin) > 0.95 ? U : shin);
      pose.rot[foot] = qmul(qconj(f.rot[cap('LowerLeg')]), footWorld);
    } else {
      pose.rot[foot] = qid();
    }
  }
  return { pose: mirror ? mirrorPose(skel, pose) : pose, missing };
}
