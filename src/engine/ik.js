/**
 * Inverse kinematics for VRM *normalized* humanoid rigs, without three.js so it runs in Node.
 *
 * A normalized rig has identity rest rotations, so every bone's rest offset is expressed in
 * the rig's own frame. Vectors are [x, y, z]; quaternions are [x, y, z, w] (three.js order).
 *
 * Solvers (in the spirit of Unity's FinalIK / Magic Poser style posing tools):
 * - limbs: analytic two-bone IK with a pole direction and a hinge joint (knees and elbows
 *   bend one way only), which never jitters and keeps the bend plane under control;
 * - spine, neck and reach: CCD (cyclic coordinate descent, Wang & Chen 1991) with per-joint
 *   weights and angle limits, so a pull spreads over several vertebrae;
 * - "full body": the hips can move while pinned hands and feet are re-solved to stay put.
 */

// ---------------------------------------------------------------- vectors

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export function norm(a, fallback = [0, 0, 0]) {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : fallback;
}
/** Part of `v` perpendicular to the unit vector `axis`. */
export const perp = (v, axis) => sub(v, scale(axis, dot(v, axis)));

// ---------------------------------------------------------------- quaternions

export const qid = () => [0, 0, 0, 1];
export function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qnorm(q) {
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}
export function qrot(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}
export function qaxis(axis, angle) {
  const a = norm(axis, [1, 0, 0]);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
/** Shortest rotation taking unit vector a to unit vector b. */
export function qfromTo(a, b) {
  const d = dot(a, b);
  if (d < -0.999999) {
    const axis = norm(cross([1, 0, 0], a), null) ?? norm(cross([0, 1, 0], a));
    return qaxis(axis, Math.PI);
  }
  const c = cross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
/** Rotation angle in radians (0..π). */
export const qangle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));
export function qslerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) {
    [bx, by, bz, bw] = [-bx, -by, -bz, -bw];
    c = -c;
  }
  if (c > 0.9995) return qnorm(a.map((v, i) => v + ([bx, by, bz, bw][i] - v) * t));
  const th = Math.acos(c);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
/** Scales a rotation's angle by t (0 = none, 1 = all). */
export const qpow = (q, t) => qslerp(qid(), q, t);
/** Limits a rotation to at most `maxRad`. */
export function qclamp(q, maxRad) {
  const a = qangle(q);
  return a > maxRad ? qpow(q, maxRad / a) : q;
}

/** Quaternion from a rotation matrix given by its columns. */
export function qfromColumns(c0, c1, c2) {
  const [m00, m10, m20] = c0;
  const [m01, m11, m21] = c1;
  const [m02, m12, m22] = c2;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qnorm(q);
}

/** Orthonormal frame [a, b', a×b'] from a primary and a secondary direction. */
function frame(a, b) {
  const x = norm(a, [1, 0, 0]);
  let y = norm(perp(b, x), null);
  if (!y) y = norm(perp(Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1], x));
  return [x, y, cross(x, y)];
}

/** Rotation taking the pair (a1 primary, b1 secondary) onto (a2, b2). */
export function qfromPairs(a1, b1, a2, b2) {
  const f1 = frame(a1, b1);
  const f2 = frame(a2, b2);
  const r1 = qfromColumns(...f1);
  const r2 = qfromColumns(...f2);
  return qnorm(qmul(r2, qconj(r1)));
}

const Deg = Math.PI / 180;

/** three.js Euler 'XYZ' (degrees) → quaternion. */
export function qfromEuler([x, y, z]) {
  const c1 = Math.cos((x * Deg) / 2);
  const c2 = Math.cos((y * Deg) / 2);
  const c3 = Math.cos((z * Deg) / 2);
  const s1 = Math.sin((x * Deg) / 2);
  const s2 = Math.sin((y * Deg) / 2);
  const s3 = Math.sin((z * Deg) / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Quaternion → three.js Euler 'XYZ' in degrees. */
export function qtoEuler(q) {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex;
  let ez;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex / Deg, ey / Deg, ez / Deg];
}

// ---------------------------------------------------------------- skeleton

/** VRM humanoid bones the poser drives, parents before children. */
export const RigBones = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

export const Limbs = {
  leftArm: { upper: 'leftUpperArm', lower: 'leftLowerArm', end: 'leftHand', kind: 'arm' },
  rightArm: { upper: 'rightUpperArm', lower: 'rightLowerArm', end: 'rightHand', kind: 'arm' },
  leftLeg: { upper: 'leftUpperLeg', lower: 'leftLowerLeg', end: 'leftFoot', kind: 'leg' },
  rightLeg: { upper: 'rightUpperLeg', lower: 'rightLowerLeg', end: 'rightFoot', kind: 'leg' },
};

/**
 * Rest skeleton: `rest` maps bone → { parent, offset } (offset from the parent bone, in the rig
 * frame). Required: hips, spine, head and the twelve limb bones; the rest is optional.
 */
export class Skeleton {
  constructor(rest) {
    this.rest = rest;
    this.names = RigBones.filter((n) => rest[n]);
    for (const n of ['hips', 'spine', 'head', ...Object.values(Limbs).flatMap((l) => [l.upper, l.lower, l.end])]) {
      if (!rest[n]) throw new Error(`ボーン ${n} がありません`);
    }
    const p = this.restPositions();
    this.up = [0, 1, 0];
    this.left = norm(perp(sub(p.leftUpperLeg, p.rightUpperLeg), this.up), [1, 0, 0]);
    this.forward = cross(this.left, this.up);
    // Rough body size for handle offsets and ground clearance.
    this.height = Math.max(0.3, p.head[1] - Math.min(p.leftFoot[1], p.rightFoot[1])) * 1.12;
    this.restPos = p;
    this.limbs = {};
    for (const [key, l] of Object.entries(Limbs)) this.limbs[key] = this.prepareLimb(l);
  }

  restPositions() {
    const pos = {};
    for (const n of this.names) {
      const { parent, offset } = this.rest[n];
      pos[n] = parent ? add(pos[parent], offset) : [...offset];
    }
    return pos;
  }

  /** Hinge axis (local = rig frame at rest) chosen so knees and elbows bend the natural way. */
  prepareLimb(limb) {
    const u = this.rest[limb.lower].offset;
    const v = this.rest[limb.end].offset;
    const dir = norm(add(u, v));
    // Elbows bend the hand forward; knees bend the foot backward.
    const toward = limb.kind === 'arm' ? this.forward : scale(this.forward, -1);
    const hinge = norm(cross(dir, toward), this.left);
    // Which side of the upper→end line the joint ends up on when bent.
    const e = add(u, qrot(qaxis(hinge, 0.6), v));
    const en = norm(e);
    const side = norm(perp(u, en));
    const sign = dot(side, cross(hinge, en)) >= 0 ? 1 : -1;
    const l1 = len(u);
    const l2 = len(v);
    return { ...limb, hinge, sign, l1, l2, reach: l1 + l2 };
  }

  parentOf(name) {
    return this.rest[name]?.parent ?? null;
  }
}

/** Pose state: local rotation per bone and the hips offset from rest (rig frame). */
export function restPose(skel) {
  const rot = {};
  for (const n of skel.names) rot[n] = qid();
  return { rot, hips: [0, 0, 0] };
}

export function clonePose(pose) {
  const rot = {};
  for (const [n, q] of Object.entries(pose.rot)) rot[n] = [...q];
  return { rot, hips: [...pose.hips] };
}

/** World (rig-frame) position and rotation of every bone. */
export function fk(skel, pose) {
  const pos = {};
  const rot = {};
  for (const n of skel.names) {
    const { parent, offset } = skel.rest[n];
    const local = pose.rot[n] ?? qid();
    if (!parent) {
      pos[n] = add(offset, pose.hips);
      rot[n] = local;
    } else {
      pos[n] = add(pos[parent], qrot(rot[parent], offset));
      rot[n] = qmul(rot[parent], local);
    }
  }
  return { pos, rot };
}

const parentRot = (skel, f, name) => {
  const p = skel.parentOf(name);
  return p ? f.rot[p] : qid();
};

/** Sets a bone's world rotation (keeps its children's local rotations). */
export function setWorldRot(skel, pose, f, name, world) {
  pose.rot[name] = qnorm(qmul(qconj(parentRot(skel, f, name)), world));
}

// ---------------------------------------------------------------- limb IK

/** Hinge angle that puts the limb end at distance d from the upper joint. */
function hingeAngle(limb, u, v, d) {
  const h = limb.hinge;
  const hu = dot(h, u);
  const hv = dot(h, v);
  // u · R(θ)v = A cosθ + B sinθ + C (Rodrigues)
  const A = dot(u, v) - hu * hv;
  const B = dot(u, cross(h, v));
  const C = hu * hv;
  const R = Math.hypot(A, B) || 1e-9;
  const phi = Math.atan2(B, A); // straightest angle
  const K = (d * d - dot(u, u) - dot(v, v)) / 2 - C;
  const bend = Math.acos(Math.max(-1, Math.min(1, K / R)));
  return phi + Math.min(bend, 165 * Deg);
}

/** Current direction the knee/elbow points to (world), never degenerate. */
export function limbPoleDir(skel, pose, limbKey, f = fk(skel, pose)) {
  const limb = skel.limbs[limbKey];
  const u = skel.rest[limb.lower].offset;
  const v = skel.rest[limb.end].offset;
  const e = add(u, qrot(pose.rot[limb.lower], v));
  const k = scale(norm(cross(limb.hinge, norm(e))), limb.sign);
  return qrot(f.rot[limb.upper], k);
}

/**
 * Two-bone IK: puts the limb end at `target` with the knee/elbow toward `pole` (a world
 * direction; default: where it points now). The end bone keeps `endRot` (world) if given,
 * else its current world rotation.
 */
export function solveLimb(skel, pose, limbKey, target, { pole = null, endRot = null } = {}) {
  const limb = skel.limbs[limbKey];
  let f = fk(skel, pose);
  const keepEnd = endRot ?? f.rot[limb.end];
  const poleDir = pole ?? limbPoleDir(skel, pose, limbKey, f);
  const A = f.pos[limb.upper];
  const u = skel.rest[limb.lower].offset;
  const v = skel.rest[limb.end].offset;
  const toT = sub(target, A);
  const d = Math.max(1e-4, len(toT));
  const w = norm(toT, qrot(f.rot[limb.upper], norm(add(u, v))));
  const theta = hingeAngle(limb, u, v, d);
  const qh = qaxis(limb.hinge, theta);
  const e = add(u, qrot(qh, v));
  const en = norm(e);
  const kl = scale(norm(cross(limb.hinge, en)), limb.sign);
  let kw = norm(perp(poleDir, w), null);
  if (!kw) kw = norm(perp(limbPoleDir(skel, pose, limbKey, f), w), norm(perp(skel.forward, w)));
  const upperWorld = qfromPairs(en, kl, w, kw);
  setWorldRot(skel, pose, f, limb.upper, upperWorld);
  pose.rot[limb.lower] = qh;
  f = fk(skel, pose);
  setWorldRot(skel, pose, f, limb.end, keepEnd);
}

// ---------------------------------------------------------------- CCD chains

/** A point on a bone: its origin plus `offset` in the bone's frame. */
export const pointOf = (f, { bone, offset = [0, 0, 0] }) => add(f.pos[bone], qrot(f.rot[bone], offset));

/**
 * CCD: rotates `chain` (root → tip, entries { bone, weight, limitDeg }) so `effector` reaches
 * `target`. Limits are on each bone's local rotation away from rest.
 */
export function solveChain(skel, pose, chain, effector, target, iterations = 12) {
  const links = chain.filter((c) => skel.rest[c.bone]);
  for (let it = 0; it < iterations; it++) {
    for (let i = links.length - 1; i >= 0; i--) {
      const { bone, weight = 1, limitDeg = 180 } = links[i];
      const f = fk(skel, pose);
      const J = f.pos[bone];
      const a = norm(sub(pointOf(f, effector), J), null);
      const b = norm(sub(target, J), null);
      if (!a || !b) continue;
      const delta = qpow(qfromTo(a, b), weight);
      setWorldRot(skel, pose, f, bone, qmul(delta, f.rot[bone]));
      pose.rot[bone] = qclamp(pose.rot[bone], limitDeg * Deg);
    }
    if (dist(pointOf(fk(skel, pose), effector), target) < skel.height * 1e-4) break;
  }
}

/** Turns `chain` so the direction `axis` (in the tip bone's frame) points toward `target`. */
export function aimChain(skel, pose, chain, tip, axis, target) {
  const links = chain.filter((c) => skel.rest[c.bone]);
  for (let it = 0; it < 4; it++) {
    for (let i = links.length - 1; i >= 0; i--) {
      const { bone, weight = 1, limitDeg = 180 } = links[i];
      const f = fk(skel, pose);
      const a = norm(qrot(f.rot[tip], axis), null);
      const b = norm(sub(target, f.pos[tip]), null);
      if (!a || !b) continue;
      const delta = qpow(qfromTo(a, b), weight);
      setWorldRot(skel, pose, f, bone, qmul(delta, f.rot[bone]));
      pose.rot[bone] = qclamp(pose.rot[bone], limitDeg * Deg);
    }
  }
}

// ---------------------------------------------------------------- pose utilities

const mirrorName = (n) => (n.startsWith('left') ? `right${n.slice(4)}` : n.startsWith('right') ? `left${n.slice(5)}` : n);

/** Left/right mirror across the body's sagittal plane. */
export function mirrorPose(skel, pose) {
  const n = skel.left;
  const reflect = (v) => sub(v, scale(n, 2 * dot(v, n)));
  const out = { rot: {}, hips: reflect(pose.hips) };
  for (const name of skel.names) {
    const q = pose.rot[mirrorName(name)] ?? qid();
    const v = [q[0], q[1], q[2]];
    const m = add(scale(v, -1), scale(n, 2 * dot(v, n)));
    out.rot[name] = [m[0], m[1], m[2], q[3]];
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10 + 0;

/** Pose → { bones: { name: [x, y, z] degrees } } like the built-in poses (rest bones omitted). */
export function poseToBones(skel, pose) {
  const bones = {};
  for (const n of skel.names) {
    const q = pose.rot[n];
    if (!q || qangle(q) < 0.05 * Deg) continue;
    bones[n] = qtoEuler(q).map(round1);
  }
  return bones;
}

export function bonesToPose(skel, bones) {
  const pose = restPose(skel);
  for (const [n, e] of Object.entries(bones ?? {})) if (skel.rest[n]) pose.rot[n] = qfromEuler(e);
  return pose;
}
