// User poses (validation, registry, store) and the MediaPipe model file handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Poses, poseById, poseLabel, setUserPoses, userPoseList, validatePose,
} from '../../src/engine/poses.js';
import { figureLabel } from '../../src/engine/figure.js';
import { loadUserPoses, saveUserPoses } from '../../src/main/userposes.js';
import { PoseModel, downloadPoseModel, importPoseModel, readPoseModel } from '../../src/main/posemodel.js';

const tmp = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ポーズ test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};

test('USERPOSE-VALIDATE: only VRM bones with finite angles; names are trimmed', () => {
  const ok = validatePose({ id: 'user:a', labelJa: '  手を振る ', bones: { leftUpperArm: [0, 0, -40] }, hips: [0, -0.1, 0] });
  assert.deepEqual(ok, { id: 'user:a', labelJa: '手を振る', bones: { leftUpperArm: [0, 0, -40] }, hips: [0, -0.1, 0] });
  assert.equal(validatePose({ bones: {} }).labelJa, '無題のポーズ');
  assert.throws(() => validatePose({ bones: { tail: [0, 0, 0] } }), /知らないボーン名/);
  assert.throws(() => validatePose({ bones: { head: [0, NaN, 0] } }), /角度/);
  assert.throws(() => validatePose({ bones: { head: [0, 0] } }), /角度/);
  assert.throws(() => validatePose(null), /ポーズのデータではありません/);
  assert.equal(validatePose({ bones: {}, hips: [0, 99, 0] }).hips, undefined, 'absurd hips offsets are dropped');
});

test('USERPOSE-REGISTRY: user poses resolve by id, broken ones are skipped, deleted ones keep a label', () => {
  setUserPoses([
    { id: 'user:x', labelJa: '自作A', bones: { head: [10, 0, 0] } },
    { id: 'user:bad', labelJa: '壊れ', bones: { nope: [0, 0, 0] } },
  ]);
  assert.deepEqual(userPoseList().map((p) => p.id), ['user:x']);
  assert.equal(poseById('user:x').labelJa, '自作A');
  assert.equal(poseById('walk').id, 'walk');
  assert.equal(poseById('user:gone'), Poses[0], 'unknown ids pose as standing');
  assert.equal(poseLabel('user:gone'), '自作ポーズ');
  assert.equal(figureLabel('figure:mannequin#user:x'), 'デッサン人形・自作A');
  setUserPoses([]);
  assert.equal(figureLabel('figure:mannequin#user:x'), 'デッサン人形・自作ポーズ');
});

test('USERPOSE-STORE: atomic save, reload, broken files and entries', async (t) => {
  const dir = await tmp(t);
  const file = path.join(dir, 'sub', 'poses.json');
  assert.deepEqual(await loadUserPoses(file), [], 'missing file = no poses');
  const saved = await saveUserPoses([
    { id: 'user:1', labelJa: '一', bones: { head: [1, 2, 3] } },
    { labelJa: 'id なしは保存しない', bones: {} },
  ], file);
  assert.equal(saved.length, 1);
  assert.deepEqual(await loadUserPoses(file), saved);
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), ['poses.json'], 'no temp files left');
  await assert.rejects(saveUserPoses([{ id: 'user:2', bones: { x: [0, 0, 0] } }], file), /知らないボーン名/);
  assert.deepEqual(await loadUserPoses(file), saved, 'a failed save keeps the old file');
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  raw.poses.push({ id: 'user:3', bones: { head: 'x' } });
  await fs.writeFile(file, JSON.stringify(raw));
  assert.deepEqual(await loadUserPoses(file), saved, 'broken entries are skipped');
  await fs.writeFile(file, '{ not json');
  assert.deepEqual(await loadUserPoses(file), []);
});

/** A fetch() stand-in that streams `body` in two chunks. */
const fakeFetch = (body, status = 200) => async () => ({
  ok: status === 200,
  status,
  headers: new Map([['content-length', String(body.length)]]),
  body: {
    getReader() {
      const parts = [body.subarray(0, body.length >> 1), body.subarray(body.length >> 1)];
      return { read: async () => (parts.length ? { done: false, value: parts.shift() } : { done: true }) };
    },
  },
});

test('POSEMODEL: hash-checked download, progress, import from disk', async (t) => {
  const dir = await tmp(t);
  const file = path.join(dir, 'models', PoseModel.file);
  assert.equal(await readPoseModel(file), null);
  const progress = [];
  await assert.rejects(downloadPoseModel(fakeFetch(Buffer.from('PK not the model')), (r) => progress.push(r), file), /ハッシュ不一致/);
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(await readPoseModel(file), null, 'a bad download is not stored');
  await assert.rejects(downloadPoseModel(fakeFetch(Buffer.alloc(0), 404), () => {}, file), /HTTP 404/);

  const notTask = path.join(dir, 'x.task');
  await fs.writeFile(notTask, Buffer.alloc(2048, 1));
  await assert.rejects(importPoseModel(notTask, file), /\.task/);
  const task = Buffer.concat([Buffer.from('PK'), Buffer.alloc(2048)]);
  const good = path.join(dir, 'ok.task');
  await fs.writeFile(good, task);
  assert.equal((await importPoseModel(good, file)).length, task.length);
  assert.deepEqual(Buffer.from(await readPoseModel(file)), task);
});
