import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePose } from '../engine/poses.js';
import { dataRoot } from './history.js';

/** Poses made in the pose editor, shared by both windows: <data>/poses.json. */
export const userPoseFile = (env = process.env) => path.join(dataRoot(env), 'poses.json');

export async function loadUserPoses(file = userPoseFile()) {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return [];
  }
  const out = [];
  for (const p of Array.isArray(raw?.poses) ? raw.poses : []) {
    try {
      const v = validatePose(p);
      if (v.id) out.push(v);
    } catch {
      // skip broken entries
    }
  }
  return out;
}

/** Writes atomically (temp file + rename) so a crash never leaves half a file. */
export async function saveUserPoses(list, file = userPoseFile()) {
  const poses = list.map(validatePose).filter((p) => p.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ version: 1, poses }, null, 1)}\n`, 'utf8');
  await fs.rename(tmp, file);
  return poses;
}
