import * as THREE from '../vendor/three-vrm.js';
import { RigBones, Skeleton } from '../../engine/ik.js';

/**
 * Reads the rest skeleton of a model (mannequin or VRM) for the IK solver. Normalized bones
 * have identity rest rotations, so offsets are taken in the frame of the hips' parent
 * (the rig root); the solver works entirely in that frame.
 */
export function rigOfModel(model) {
  const { humanoid, scene } = model;
  humanoid.resetNormalizedPose();
  model.update();
  scene.updateMatrixWorld(true);
  const hips = humanoid.getNormalizedBoneNode('hips');
  if (!hips) throw new Error('hips ボーンがありません');
  const root = hips.parent;
  const toRoot = root.matrixWorld.clone().invert();
  const nodes = {};
  const pos = {};
  for (const name of RigBones) {
    const node = humanoid.getNormalizedBoneNode(name);
    if (!node) continue;
    nodes[name] = node;
    pos[name] = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(toRoot);
  }
  const byNode = new Map(Object.entries(nodes).map(([n, node]) => [node, n]));
  const rest = {};
  for (const [name, node] of Object.entries(nodes)) {
    let p = node.parent;
    while (p && !byNode.has(p)) p = p.parent;
    const parent = p ? byNode.get(p) : null;
    const offset = parent ? pos[name].clone().sub(pos[parent]) : pos[name];
    rest[name] = { parent, offset: offset.toArray() };
  }
  // The floor: the lowest point of the model at rest, in the rig frame.
  const box = new THREE.Box3().setFromObject(scene, true);
  const floor = new THREE.Vector3(0, box.min.y, 0).applyMatrix4(toRoot).y;
  return { skel: new Skeleton(rest), root, nodes, hipsRest: hips.position.clone(), floorY: floor };
}

/** Puts a solver pose on the model's normalized bones. */
export function applyRigPose(rig, model, pose) {
  for (const [name, node] of Object.entries(rig.nodes)) {
    const q = pose.rot[name];
    if (q) node.quaternion.set(q[0], q[1], q[2], q[3]);
  }
  rig.nodes.hips.position.copy(rig.hipsRest).add(new THREE.Vector3(...pose.hips));
  model.update();
  model.scene.updateMatrixWorld(true);
}
