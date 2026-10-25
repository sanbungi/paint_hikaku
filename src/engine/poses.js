/**
 * Sample poses as Euler angles (degrees, three.js 'XYZ' order) for VRM *normalized* humanoid bones.
 * Normalized space: rest pose is a T-pose facing +Z, the character's left hand on +X, up is +Y.
 * Handy signs: left arm down = z −, right arm down = z +; after lowering, x − swings an arm forward;
 * thigh forward = x −, knee bend = x +; head turn to the character's left = y +, look up = x −;
 * left elbow bend forward = y −, right elbow = y +.
 * The figure is grounded after posing, so poses never move the hips vertically.
 */
export const Poses = [
  {
    id: 'stand',
    labelJa: '立ち（自然体）',
    bones: {
      leftUpperArm: [0, 0, -72], rightUpperArm: [0, 0, 72],
      leftLowerArm: [0, -12, 0], rightLowerArm: [0, 12, 0],
      leftUpperLeg: [0, 0, 2], rightUpperLeg: [0, 0, -2],
    },
  },
  { id: 'tpose', labelJa: 'Tポーズ', bones: {} },
  {
    id: 'contrapposto',
    labelJa: 'コントラポスト',
    bones: {
      hips: [0, 6, 6], spine: [0, 0, -5], chest: [0, -4, -4], neck: [0, 0, 3], head: [4, 14, 4],
      leftUpperArm: [10, 0, -74], leftLowerArm: [0, -18, 0],
      rightUpperArm: [-8, 18, 70], rightLowerArm: [0, 40, 0],
      leftUpperLeg: [0, 0, -4], rightUpperLeg: [-12, -6, -8], rightLowerLeg: [22, 0, 0], rightFoot: [-8, 0, 0],
    },
  },
  {
    id: 'walk',
    labelJa: '歩き',
    bones: {
      spine: [3, 4, 0], chest: [0, -6, 0], head: [-2, 2, 0],
      leftUpperArm: [22, 0, -76], leftLowerArm: [0, -12, 0],
      rightUpperArm: [-24, 0, 76], rightLowerArm: [0, 28, 0],
      leftUpperLeg: [-26, 0, 0], leftLowerLeg: [8, 0, 0], leftFoot: [-6, 0, 0],
      rightUpperLeg: [18, 0, 0], rightLowerLeg: [32, 0, 0], rightFoot: [-14, 0, 0],
    },
  },
  {
    id: 'run',
    labelJa: '走り',
    bones: {
      spine: [12, 6, 0], chest: [4, -10, 0], head: [-10, 4, 0],
      leftUpperArm: [48, 0, -70], leftLowerArm: [0, -85, 0],
      rightUpperArm: [-52, 0, 70], rightLowerArm: [0, 95, 0],
      leftUpperLeg: [-62, 0, 0], leftLowerLeg: [68, 0, 0], leftFoot: [-10, 0, 0],
      rightUpperLeg: [28, 0, 0], rightLowerLeg: [86, 0, 0], rightFoot: [20, 0, 0],
    },
  },
  {
    id: 'sit',
    labelJa: '座り（椅子）',
    bones: {
      spine: [6, 0, 0], head: [6, 0, 0],
      leftUpperArm: [-30, 0, -70], leftLowerArm: [0, -45, 0],
      rightUpperArm: [-30, 0, 70], rightLowerArm: [0, 45, 0],
      leftUpperLeg: [-88, 0, 4], leftLowerLeg: [86, 0, 0],
      rightUpperLeg: [-88, 0, -4], rightLowerLeg: [86, 0, 0],
    },
  },
  {
    id: 'crouch',
    labelJa: 'しゃがみ',
    bones: {
      spine: [24, 0, 0], chest: [10, 0, 0], head: [-22, 0, 0],
      leftUpperArm: [-50, 0, -64], leftLowerArm: [0, -30, 0],
      rightUpperArm: [-50, 0, 64], rightLowerArm: [0, 30, 0],
      leftUpperLeg: [-118, 0, 10], leftLowerLeg: [138, 0, 0], leftFoot: [-20, 0, 0],
      rightUpperLeg: [-118, 0, -10], rightLowerLeg: [138, 0, 0], rightFoot: [-20, 0, 0],
    },
  },
  {
    id: 'think',
    labelJa: '考える（腕組み）',
    bones: {
      head: [12, -10, -6], neck: [4, 0, 0],
      leftUpperArm: [-28, 0, -72], leftLowerArm: [0, -110, 0],
      rightUpperArm: [-20, 10, 74], rightLowerArm: [0, 145, 0], rightHand: [0, 0, -30],
      rightUpperLeg: [0, 0, -4], leftUpperLeg: [0, 0, 4],
    },
  },
  {
    id: 'reach',
    labelJa: '見上げて手を伸ばす',
    bones: {
      spine: [-4, 0, 4], chest: [-6, 0, 4], neck: [-10, 0, 0], head: [-22, -8, 0],
      rightUpperArm: [-10, 0, -62], rightLowerArm: [0, 10, 0],
      leftUpperArm: [6, 0, -70], leftLowerArm: [0, -20, 0],
      leftUpperLeg: [0, 0, 6], rightUpperLeg: [8, 0, -2], rightLowerLeg: [10, 0, 0], rightFoot: [24, 0, 0],
    },
  },
];

/** Poses made in the pose editor: ids start with this prefix. */
export const UserPosePrefix = 'user:';

let userPoses = [];

export const isUserPoseId = (id) => typeof id === 'string' && id.startsWith(UserPosePrefix);

export function setUserPoses(list) {
  userPoses = [];
  for (const p of list ?? []) {
    try {
      userPoses.push(validatePose(p));
    } catch {
      // A broken entry is skipped, the others still load.
    }
  }
}

export const userPoseList = () => userPoses;

export function poseById(id) {
  return Poses.find((p) => p.id === id) ?? userPoses.find((p) => p.id === id) ?? Poses[0];
}

/** Label for history entries: a deleted user pose still reads as one. */
export function poseLabel(id) {
  const p = Poses.find((q) => q.id === id) ?? userPoses.find((q) => q.id === id);
  if (p) return p.labelJa;
  return isUserPoseId(id) ? '自作ポーズ' : Poses[0].labelJa;
}

const PoseBones = new Set([
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]);

/**
 * Checks pose data from a file or the store: { id?, labelJa, bones: { bone: [x, y, z] }, hips? }.
 * Returns a clean copy; throws with a message for the user.
 */
export function validatePose(p) {
  if (!p || typeof p !== 'object' || !p.bones || typeof p.bones !== 'object') throw new Error('ポーズのデータではありません');
  const bones = {};
  for (const [name, e] of Object.entries(p.bones)) {
    if (!PoseBones.has(name)) throw new Error(`知らないボーン名です: ${name}`);
    if (!Array.isArray(e) || e.length !== 3 || !e.every((v) => Number.isFinite(v) && Math.abs(v) <= 360)) {
      throw new Error(`角度が正しくありません: ${name}`);
    }
    bones[name] = e.map(Number);
  }
  const labelJa = String(p.labelJa ?? p.name ?? '').trim().slice(0, 60) || '無題のポーズ';
  const out = { id: typeof p.id === 'string' && p.id ? p.id.slice(0, 80) : '', labelJa, bones };
  if (Array.isArray(p.hips) && p.hips.length === 3 && p.hips.every((v) => Number.isFinite(v) && Math.abs(v) < 10)) {
    out.hips = p.hips.map(Number);
  }
  return out;
}
