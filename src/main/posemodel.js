import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './history.js';

/**
 * MediaPipe Pose Landmarker (full), Apache-2.0. Not bundled (≈9 MB): downloaded once on the
 * user's request and checked against this hash, or picked from disk for offline machines.
 */
export const PoseModel = {
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  sha256: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  size: 9398198,
  file: 'pose_landmarker_full.task',
};

export const poseModelPath = (env = process.env) => path.join(dataRoot(env), 'models', PoseModel.file);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function readPoseModel(file = poseModelPath()) {
  try {
    return new Uint8Array(await fs.readFile(file));
  } catch {
    return null;
  }
}

async function store(buf, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, file);
}

/** Downloads with `fetchImpl` (Electron's net.fetch uses the system proxy). */
export async function downloadPoseModel(fetchImpl, onProgress = () => {}, file = poseModelPath()) {
  const res = await fetchImpl(PoseModel.url);
  if (!res.ok) throw new Error(`ダウンロードに失敗しました (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || PoseModel.size;
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const buf = Buffer.concat(chunks);
  if (sha256(buf) !== PoseModel.sha256) throw new Error('ダウンロードしたモデルが壊れています（ハッシュ不一致）');
  await store(buf, file);
  return new Uint8Array(buf);
}

/** A model file the user chose (any MediaPipe pose_landmarker .task). */
export async function importPoseModel(src, file = poseModelPath()) {
  const buf = await fs.readFile(src);
  // .task files are zip archives ("PK").
  if (buf.length < 1024 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('MediaPipe のモデル（.task）ではありません');
  await store(buf, file);
  return new Uint8Array(buf);
}
