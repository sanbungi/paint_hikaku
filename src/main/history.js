import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRecord, serializeRecord } from '../engine/trend.js';

/** Same locations as the D version, so existing histories keep loading. */
export function dataRoot(env = process.env, platform = process.platform) {
  if (env.PAINT_HIKAKU_DATA_DIR) return env.PAINT_HIKAKU_DATA_DIR;
  if (platform === 'win32') return path.join(env.APPDATA || '.', 'paint_hikaku');
  const home = env.HOME || os.homedir();
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'paint_hikaku');
}

export function sessionDir(env = process.env) {
  return path.join(dataRoot(env), 'sessions');
}

/** Sortable by time, safe on every OS (no ':' or '\\'), unique per call. */
export function recordFileName(rec) {
  const stamp = rec.isoTime.replace(/[^A-Za-z0-9-]/g, '');
  const digest = createHash('sha256').update(rec.templateId, 'utf8').digest('hex').toUpperCase();
  return `${stamp}_${digest}_${randomUUID()}.json`;
}

export async function saveSession(rec, root = sessionDir()) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, recordFileName(rec));
  await fs.writeFile(file, serializeRecord(rec), 'utf8');
  return file;
}

export async function loadRecent(limit = 24, root = sessionDir()) {
  let names;
  try {
    names = (await fs.readdir(root)).filter((n) => n.endsWith('.json'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  names.sort();
  const recs = [];
  for (const name of names.slice(-limit)) {
    try {
      recs.push(parseRecord(await fs.readFile(path.join(root, name), 'utf8')));
    } catch {
      // Broken or foreign JSON is skipped, never fatal.
    }
  }
  return recs;
}
