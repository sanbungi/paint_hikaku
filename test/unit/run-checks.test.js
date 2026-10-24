// The CI gate must reject skipped, failed, and hung test processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'run-checks.js');

function check(code, timeout = 10) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-hikaku-gate-'));
  try {
    return spawnSync(process.execPath, [runner, '--name', 'gate', '--timeout', String(timeout),
      '--expect', 'PASS expected', '--', process.execPath, '-e', code], { cwd, encoding: 'utf8', timeout: 20_000 });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('RUN-CHECKS: success', () => {
  assert.equal(check("console.log('PASS expected')").status, 0);
});

test('RUN-CHECKS: missing marker fails', () => {
  assert.notEqual(check("console.log('No tests executed')").status, 0);
});

test('RUN-CHECKS: crash after PASS fails', () => {
  assert.notEqual(check("console.log('PASS expected'); process.exit(3)").status, 0);
});

test('RUN-CHECKS: isolated data directory is provided', () => {
  assert.equal(check("if (process.env.PAINT_HIKAKU_DATA_DIR) console.log('PASS expected')").status, 0);
});

test('RUN-CHECKS: timeout fails', () => {
  const result = check('setTimeout(() => {}, 30000)', 1);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /TIMEOUT/);
});
