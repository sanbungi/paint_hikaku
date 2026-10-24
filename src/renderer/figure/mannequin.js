import * as THREE from '../vendor/three-vrm.js';

/**
 * A wooden drawing mannequin rigged with VRM humanoid bone names, so the same poses drive
 * it and loaded VRM models. Rest pose: T-pose facing +Z, character's left on +X, about 1.7 m tall.
 */
const Rig = [
  // [bone, parent, rest offset from parent]
  ['hips', null, [0, 0.93, 0]],
  ['spine', 'hips', [0, 0.08, 0]],
  ['chest', 'spine', [0, 0.14, 0]],
  ['neck', 'chest', [0, 0.24, 0]],
  ['head', 'neck', [0, 0.09, 0]],
  ['leftShoulder', 'chest', [0.03, 0.2, 0]],
  ['leftUpperArm', 'leftShoulder', [0.13, 0, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.27, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.24, 0, 0]],
  ['rightShoulder', 'chest', [-0.03, 0.2, 0]],
  ['rightUpperArm', 'rightShoulder', [-0.13, 0, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.27, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.24, 0, 0]],
  ['leftUpperLeg', 'hips', [0.09, -0.04, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0, -0.42, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.4, 0]],
  ['rightUpperLeg', 'hips', [-0.09, -0.04, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [0, -0.42, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.4, 0]],
];

const wood = () => new THREE.MeshStandardMaterial({ color: 0xd9b88f, roughness: 0.72 });
const joint = () => new THREE.MeshStandardMaterial({ color: 0xc09a6c, roughness: 0.6 });

function ellipsoid(material, [rx, ry, rz], [x, y, z]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
  m.scale.set(rx, ry, rz);
  m.position.set(x, y, z);
  return m;
}

/** Tapered cylinder from the bone origin along `dir` (unit axis vector). */
function limb(material, length, r0, r1, dir) {
  const g = new THREE.CylinderGeometry(r1, r0, length, 20);
  const m = new THREE.Mesh(g, material);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
  m.position.set(dir[0] * length * 0.5, dir[1] * length * 0.5, dir[2] * length * 0.5);
  return m;
}

function ball(material, r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), material);
}

function box(material, [w, h, d], [x, y, z]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 1, 1, 1), material);
  m.position.set(x, y, z);
  return m;
}

function dress(bones) {
  const body = wood();
  const jt = joint();
  bones.hips.add(ellipsoid(body, [0.15, 0.1, 0.1], [0, 0.02, 0]));
  bones.spine.add(ellipsoid(body, [0.12, 0.09, 0.085], [0, 0.08, 0]));
  bones.chest.add(ellipsoid(body, [0.16, 0.17, 0.11], [0, 0.11, 0]));
  bones.neck.add(limb(jt, 0.1, 0.045, 0.042, [0, 1, 0]));
  bones.head.add(ellipsoid(body, [0.085, 0.115, 0.1], [0, 0.1, 0.01]));
  // A nose so the facing direction reads at a glance.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 12), body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.09, 0.115);
  bones.head.add(nose);
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const b = (name) => bones[`${side}${name}`];
    b('UpperArm').add(ball(jt, 0.055), limb(body, 0.27, 0.05, 0.04, [s, 0, 0]));
    b('LowerArm').add(ball(jt, 0.045), limb(body, 0.24, 0.04, 0.032, [s, 0, 0]));
    b('Hand').add(ball(jt, 0.034), box(body, [0.15, 0.035, 0.08], [s * 0.085, 0, 0.005]));
    b('UpperLeg').add(ball(jt, 0.075), limb(body, 0.42, 0.075, 0.055, [0, -1, 0]));
    b('LowerLeg').add(ball(jt, 0.056), limb(body, 0.4, 0.052, 0.04, [0, -1, 0]));
    b('Foot').add(ball(jt, 0.042), box(body, [0.09, 0.06, 0.24], [0, -0.04, 0.06]));
  }
}

export function createMannequin() {
  const scene = new THREE.Group();
  scene.name = 'mannequin';
  const bones = {};
  const rest = {};
  for (const [name, parent, offset] of Rig) {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(...offset);
    rest[name] = node.position.clone();
    (parent ? bones[parent] : scene).add(node);
    bones[name] = node;
  }
  dress(bones);
  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name) => bones[name] ?? null,
      resetNormalizedPose() {
        for (const [name, node] of Object.entries(bones)) {
          node.position.copy(rest[name]);
          node.quaternion.identity();
        }
      },
    },
    update() {},
    dispose() {
      scene.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
