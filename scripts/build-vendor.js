#!/usr/bin/env node
// The renderer loads plain ES modules without a bundler; only third-party code goes to vendor/.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

await build({
  entryPoints: ['scripts/vendor-entry.js'],
  outfile: 'src/renderer/vendor/three-vrm.js',
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'chrome120',
  legalComments: 'eof',
  logLevel: 'warning',
});

// MediaPipe Tasks (image → pose in the pose editor): the ES module and its SIMD WebAssembly
// runtime, copied as published. The pose model itself is downloaded on first use.
const mediapipe = 'node_modules/@mediapipe/tasks-vision';
const out = 'src/renderer/vendor/mediapipe';
await fs.mkdir(path.join(out, 'wasm'), { recursive: true });
await fs.copyFile(path.join(mediapipe, 'vision_bundle.mjs'), path.join(out, 'vision_bundle.mjs'));
for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  await fs.copyFile(path.join(mediapipe, 'wasm', name), path.join(out, 'wasm', name));
}
