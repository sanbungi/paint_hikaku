#!/usr/bin/env node
// Runs a test command with isolated storage, a timeout and required PASS markers; keeps the log.
// usage: node scripts/run-checks.js --name smoke [--timeout 180] [--expect "PASS X"]... -- command args...
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parse(argv) {
  const opts = { name: null, timeout: 180, expect: [], command: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts.command = argv.slice(i + 1);
      break;
    }
    if (a === '--name') opts.name = argv[++i];
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--expect') opts.expect.push(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  if (!opts.name || !opts.command.length) throw new Error('--name and a command after -- are required');
  return opts;
}

const opts = parse(process.argv.slice(2));
const output = path.resolve('test-results');
fs.mkdirSync(output, { recursive: true });
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-hikaku-check-'));

const [cmd, ...args] = opts.command;
const child = spawn(cmd, args, {
  env: { ...process.env, PAINT_HIKAKU_DATA_DIR: storage, PAINT_HIKAKU_TEST_OUTPUT: path.join(output, opts.name) },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32' && !/\.exe$/i.test(cmd),
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  if (process.platform === 'win32') spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
  else child.kill('SIGKILL');
}, opts.timeout * 1000);

child.on('close', (code) => {
  clearTimeout(timer);
  if (timedOut) log += '\nTIMEOUT\n';
  fs.writeFileSync(path.join(output, `${opts.name}.log`), log, 'utf8');
  fs.rmSync(storage, { recursive: true, force: true });
  const failed = timedOut || code !== 0;
  if (failed) console.log(log.slice(-16000));
  else console.log(log.split(/\r?\n/).filter((l) => l.startsWith('PASS ')).join('\n'));
  const missing = opts.expect.filter((m) => !log.includes(m));
  if (missing.length) console.log('Missing required test markers:', missing);
  process.exit(failed || missing.length ? 1 : 0);
});
