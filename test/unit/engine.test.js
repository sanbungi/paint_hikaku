// Ports of the D engine unittests (engine.regression and per-module tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasSize, OverlayMode, AlignMode, point } from '../../src/engine/types.js';
import { interpolateStroke, strokeJitter } from '../../src/engine/stroke.js';
import {
  Mask, composeOverlay, composePaper, composeSample, composeWipe, maskBBox, maskCentroid, shiftMask, stampDisc,
} from '../../src/engine/raster.js';
import { compareMasks } from '../../src/engine/compare.js';
import { commentsFor, diagnose } from '../../src/engine/diagnose.js';
import { builtinCatalog, fromRgbaInk, renderBuiltin, renderTemplate } from '../../src/engine/templates.js';
import { defaultPerspective, makeCam, project, v3 } from '../../src/engine/perspective.js';
import { meshBox, meshPrism } from '../../src/engine/solids.js';
import { practiceGuides, stampGrid } from '../../src/engine/grid.js';
import { fitRect, squareView } from '../../src/engine/viewgeom.js';
import { BoardState } from '../../src/engine/board.js';
import { createMetrics } from '../../src/engine/types.js';

const inkOf = (m) => m.px.reduce((n, p) => n + (p ? 1 : 0), 0);

test('engine.stroke: interpolation keeps the start point and fills the gap', () => {
  const ip = interpolateStroke({ points: [point(0, 0), point(10, 0), point(20, 0)] }, 2);
  assert.ok(ip.length >= 3);
  assert.equal(ip[0].x, 0);
  assert.equal(ip.at(-1).x, 20);
});

test('engine.stroke: a straight line has no jitter, a zigzag has some', () => {
  const straight = { points: Array.from({ length: 20 }, (_, i) => point(i * 5, 0)) };
  const zigzag = { points: Array.from({ length: 20 }, (_, i) => point(i * 5, (i % 3) * 6)) };
  assert.equal(strokeJitter([straight]), 0);
  assert.ok(strokeJitter([zigzag]) > 2.4);
});

test('engine.viewgeom: any aspect ratio gives a square view', () => {
  const wide = squareView(0, 0, 1200, 400, 768);
  assert.equal(wide.w, wide.h);
  assert.equal(wide.w, 400);
  const tall = squareView(10, 20, 300, 900, 768);
  assert.deepEqual([tall.w, tall.x, tall.y], [300, 10, 20 + (900 - 300) / 2]);
  assert.equal(squareView(0, 0, 2000, 1800).w, 1800);
  assert.equal(squareView(0, 0, 2000, 1800, 768).w, 768);
  const top = squareView(0, 10, 400, 800, Infinity, 'top');
  assert.deepEqual([top.y, top.w], [10, 400]);
  assert.ok(squareView(0, 0, 0, 100, 768).empty);
});

test('engine.viewgeom: images are letterboxed keeping their aspect ratio', () => {
  assert.deepEqual(fitRect(2, 1, 8), { x: 0, y: 2, w: 8, h: 4 });
  assert.deepEqual(fitRect(100, 400, 768), { x: 288, y: 0, w: 192, h: 768 });
  assert.deepEqual(fitRect(0, 0, 8), { x: 0, y: 0, w: 8, h: 8 });
});

test('engine.raster: disc centroid and colour template sample', () => {
  const m = new Mask(32, 32);
  stampDisc(m, 16, 16, 4);
  const c = maskCentroid(m);
  assert.ok(c.count > 10 && c.x > 12 && c.x < 20);
  const color = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) color.set([10, 200, 30, 255], i * 4);
  const samp = composeSample(new Mask(32, 32), new Mask(32, 32), color);
  assert.deepEqual([...samp.slice(0, 3)], [10, 200, 30]);
});

test('engine.regression: the circle raster stays round', () => {
  const b = maskBBox(renderBuiltin('circle', 128, 3));
  const ar = b.width / b.height;
  assert.ok(ar > 0.85 && ar < 1.15, 'circle raster became non-square');
  assert.ok(b.width > 20);
});

test('engine.regression: template change clears user ink only when asked', () => {
  const st = new BoardState();
  const c = renderBuiltin('circle', CanvasSize, 4);
  const r = renderBuiltin('rect', CanvasSize, 4);
  st.setTemplate(c, new Mask(), true);
  st.beginStroke(100, 100, 1);
  st.addPoint(120, 120, 1);
  const before = inkOf(st.user);
  assert.ok(before > 0);
  st.setTemplate(r, new Mask(), false); // same as a perspective tweak
  assert.equal(inkOf(st.user), before);
  assert.notEqual(st.tpl, c);
  st.setTemplate(c, new Mask(), true);
  assert.equal(inkOf(st.user), 0);
});

test('engine.regression: the paper never shows the sample blue', () => {
  const user = new Mask(64, 64);
  stampDisc(user, 10, 10, 3);
  const paper = composePaper(user);
  let blue = 0;
  let black = 0;
  let white = 0;
  for (let o = 0; o < paper.length; o += 4) {
    const rgb = `${paper[o]},${paper[o + 1]},${paper[o + 2]}`;
    if (rgb === '50,90,210') blue++;
    if (rgb === '28,28,32') black++;
    if (rgb === '255,255,255') white++;
  }
  assert.equal(blue, 0);
  assert.ok(black > 0 && white > black);
});

test('engine.regression: wipe shows sample colour left and user colour right', () => {
  const tpl = new Mask(20, 1);
  tpl.px.fill(255);
  const user = new Mask(20, 1);
  user.px.fill(255);
  const color = new Uint8ClampedArray(20 * 4);
  for (let i = 0; i < 20; i++) color.set([1, 2, 3, 255], i * 4);
  const rgba = composeWipe(tpl, user, new Mask(20, 1), 50, color);
  assert.deepEqual([...rgba.slice(0, 4)], [1, 2, 3, 255]);
  assert.deepEqual([...rgba.slice(18 * 4, 19 * 4)], [200, 50, 60, 255]);
  assert.deepEqual([...rgba.slice(9 * 4, 10 * 4)], [40, 40, 45, 255]); // divider
});

test('engine.regression: check enters result mode, clear leaves it', () => {
  const st = new BoardState();
  st.beginStroke(10, 10, 1);
  st.addPoint(40, 40, 1);
  st.enterResult();
  assert.ok(st.resultMode && st.strokes.length === 1 && !st.drawing);
  st.clearInk();
  assert.ok(!st.resultMode && st.strokes.length === 0);
});

test('engine.regression: camera distance 1 is closer than 25, closer draws larger', () => {
  const p = defaultPerspective();
  const near = makeCam({ ...p, dist: 1 }, 768);
  const far = makeCam({ ...p, dist: 25 }, 768);
  assert.ok(near.camDist < far.camDist);
  const size = (dist) => maskBBox(renderTemplate('solid_cube', { ...p, dist }, 256).ink).width;
  assert.ok(size(10) > size(80));
});

test('engine.perspective: the origin projects onto the canvas', () => {
  const pt = project(makeCam(defaultPerspective(), 128), v3(0, 0, 0));
  assert.ok(pt.x > 20 && pt.x < 108);
});

test('engine.solids: mesh topology', () => {
  const c = meshBox(1, 1, 1);
  assert.equal(c.v.length, 8);
  assert.equal(c.e.length, 12);
  assert.equal(meshPrism(8, 1, 1).v.length, 16);
});

test('engine.templates: catalog has shapes, drills and solids, all drawable', () => {
  const cat = builtinCatalog();
  assert.equal(cat.length, 18);
  for (const kind of ['shape', 'drill', 'solid']) assert.ok(cat.some((t) => t.kind === kind));
  assert.ok(maskCentroid(renderBuiltin('circle', 128, 3)).count > 50);
  assert.ok(maskCentroid(renderBuiltin('solid_cube', 128, 2)).count > 40);
});

test('engine.templates: dark pixels become ink, transparent ones paper', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 200, 10, 10, 255]);
  assert.deepEqual([...fromRgbaInk(rgba, 4, 1).px], [255, 0, 0, 255]);
});

test('engine.grid: guides are independent of the scoring mask', () => {
  const m = new Mask(12, 12);
  stampGrid(m, 2);
  assert.ok(m.at(5, 0) || m.at(6, 0));
  assert.ok(inkOf(m) > 10);
  const tpl = renderBuiltin('circle', 96, 3);
  const before = tpl.px.slice();
  practiceGuides(96, 4, tpl, true);
  assert.deepEqual(tpl.px, before);
});

test('engine.compare: identical masks have IoU 1, a shift shows up in dx', () => {
  const a = renderBuiltin('circle', 96, 3);
  assert.equal(compareMasks(a, a).iou, 1);
  const met = compareMasks(a, shiftMask(a, 8, 0));
  assert.ok(met.dx > 4 && met.iou < 1);
});

test('engine.diagnose: a right shift is reported as 右', () => {
  const m = { ...createMetrics(), dx: 40, dy: 2, iou: 0.3, missRate: 0.2 };
  const c = commentsFor(m, false);
  assert.ok(c.length >= 2);
  assert.ok(c.some((s) => s.includes('右')));
  assert.match(commentsFor(m, true)[0], /まだ線がありません/);
});

test('engine.diagnose: centroid alignment removes the offset', () => {
  const tpl = renderBuiltin('circle', 128, 3);
  const user = shiftMask(tpl, 20, 0);
  assert.ok(diagnose(tpl, user, [], AlignMode.none).metrics.dx > 15);
  assert.ok(Math.abs(diagnose(tpl, user, [], AlignMode.centroid).metrics.dx) < 1);
});

test('engine.regression: undo removes only the last stroke', () => {
  const st = new BoardState();
  for (const y of [100, 300]) {
    st.beginStroke(100, y, 1);
    st.addPoint(300, y, 1);
    st.endStroke();
  }
  st.undo();
  assert.equal(st.strokes.length, 1);
  assert.ok(st.user.at(200, 100));
  assert.ok(!st.user.at(200, 300));
});

test('engine.regression: every overlay mode composes', () => {
  const tpl = renderBuiltin('circle', 64, 3);
  const user = shiftMask(tpl, 3, 0);
  for (const mode of Object.values(OverlayMode)) {
    const rgba = composeOverlay(tpl, user, mode, new Float32Array(64 * 64));
    assert.equal(rgba.length, 64 * 64 * 4);
  }
});
