#!/usr/bin/env node
// The renderer loads plain ES modules without a bundler; only three.js and three-vrm are bundled.
import { build } from 'esbuild';

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
