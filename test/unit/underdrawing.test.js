// Underdrawing export (下絵): sizes, framing, guide geometry and layer composition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mask } from '../../src/engine/raster.js';
import {
  Aspects, UnderLayers, bboxGuides, boxEdges, composeUnderdrawing, defaultUnderdrawingOptions, exportSize,
  fitCrop, frameInView, rasterizeGuides, safeFileName,
} from '../../src/engine/underdrawing.js';

const ink = (m) => m.px.reduce((n, v) => n + (v ? 1 : 0), 0);
const px = (rgba, w, x, y) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

test('UNDER-SIZE: output sizes and frames keep the aspect', () => {
  assert.deepEqual(exportSize(2048, 3 / 4), { width: 1536, height: 2048 });
  assert.deepEqual(exportSize(2048, 16 / 9), { width: 2048, height: 1152 });
  assert.deepEqual(exportSize(1024, Aspects.a4portrait.value), { width: 724, height: 1024 });
  const f = frameInView(1000, 600, 3 / 4);
  assert.deepEqual(f, { x: 275, y: 0, width: 450, height: 600 });
  const g = frameInView(400, 800, 1);
  assert.deepEqual(g, { x: 0, y: 200, width: 400, height: 400 });
});

test('UNDER-FIT: the crop holds the figure with a margin, centred, at the aspect', () => {
  const bbox = { x0: 100, y0: 50, x1: 139, y1: 249, width: 40, height: 200, empty: false };
  const c = fitCrop(bbox, 3 / 4, 0.05);
  assert.ok(Math.abs(c.width / c.height - 3 / 4) < 1e-9);
  assert.ok(c.x <= 100 && c.y <= 50 - 9.9 && c.x + c.width >= 140 && c.y + c.height >= 250 + 9.9, JSON.stringify(c));
  assert.ok(Math.abs(c.x + c.width / 2 - 120) < 1e-9 && Math.abs(c.y + c.height / 2 - 150) < 1e-9, 'centred');
  // A wide figure in a tall frame grows in height.
  const wide = fitCrop({ ...bbox, x1: 499, width: 400, y1: 99, height: 50 }, 3 / 4, 0);
  assert.equal(wide.width, 400);
  assert.ok(Math.abs(wide.height - 400 / 0.75) < 1e-9);
  assert.equal(fitCrop({ empty: true }, 1, 0), null);
});

test('UNDER-GUIDES: screen box with dashed centre lines, 3D box edges, circles and dots', () => {
  const cov = new Mask(100, 120);
  for (let y = 20; y < 100; y++) for (let x = 30; x < 60; x++) cov.set(x, y);
  const g = bboxGuides(cov);
  assert.deepEqual(g.lines[0].pts, [[30, 20], [60, 20], [60, 100], [30, 100]]);
  assert.ok(g.lines[0].closed && g.lines[1].dash && g.lines[2].dash);
  const m = rasterizeGuides(100, 120, g, 1);
  assert.ok(m.at(30, 60) && m.at(59, 20) && m.at(45, 99), 'box edges drawn');
  // Dashed: the vertical centre line has gaps.
  let on = 0;
  for (let y = 22; y < 98; y++) if (m.at(45, y)) on++;
  assert.ok(on > 30 && on < 70, `dashed (${on} of 76)`);
  assert.deepEqual(bboxGuides(new Mask(10, 10)), { lines: [] });

  const corners = Array.from({ length: 8 }, (_, i) => [i & 1 ? 80 : 20, i & 2 ? 90 : 10]);
  assert.equal(boxEdges(corners).lines.length, 12);
  corners[7] = null;
  assert.equal(boxEdges(corners).lines.length, 9, 'edges behind the camera are left out');

  const c = rasterizeGuides(60, 60, { circles: [{ x: 30, y: 30, r: 20 }], dots: [{ x: 5, y: 5, r: 3 }] }, 2);
  assert.ok(c.at(50, 30) && c.at(30, 10) && !c.at(30, 30), 'circle outline, hollow');
  assert.ok(c.at(5, 5) && c.at(6, 6), 'dot');
});

test('UNDER-COMPOSE: layer order, opacity, single layers and backgrounds', () => {
  const w = 4;
  const h = 1;
  const shaded = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w; i++) shaded.set([200, 100, 0, i < 2 ? 255 : 0], i * 4);
  const lines = new Mask(w, h);
  lines.set(0, 0);
  const bbox = new Mask(w, h);
  bbox.set(0, 0);
  bbox.set(3, 0);
  const opts = { ...defaultUnderdrawingOptions(), shadedOpacity: 0.5 };
  opts.layers = { ...opts.layers, shaded: true, lines: true, bbox: true };
  const out = composeUnderdrawing(w, h, { shaded, lines, bbox }, opts);
  assert.deepEqual(px(out, w, 0, 0), [28, 28, 32, 255], 'line art is on top');
  assert.deepEqual(px(out, w, 1, 0), [228, 178, 128, 255], 'faint shading over white');
  assert.deepEqual(px(out, w, 2, 0), [255, 255, 255, 255], 'white background');
  const red = px(out, w, 3, 0);
  assert.ok(red[0] > 200 && red[1] < 90, `box guide in red (${red})`);
  // One layer, transparent: only its own ink.
  const only = composeUnderdrawing(w, h, { shaded, lines, bbox }, opts, { only: ['bbox'], background: 'transparent' });
  assert.equal(px(only, w, 1, 0)[3], 0);
  assert.ok(px(only, w, 3, 0)[3] > 200);
  // Disabled layers are skipped.
  const noLines = composeUnderdrawing(w, h, { shaded, lines, bbox }, { ...opts, layers: { ...opts.layers, lines: false, bbox: false } });
  assert.deepEqual(px(noLines, w, 0, 0), [228, 178, 128, 255]);
  assert.equal(UnderLayers.at(-1).id, 'lines', 'line art is the top layer');
  assert.ok(ink(lines) === 1);
});

test('UNDER-NAMES: file names are safe on Windows', () => {
  assert.equal(safeFileName('かがむ:ポーズ/1?'), 'かがむ_ポーズ_1_');
  assert.equal(safeFileName('  '), '下絵');
  assert.equal(safeFileName('name. '), 'name');
  assert.equal(safeFileName('x'.repeat(200)).length, 80);
});
