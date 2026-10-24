// Drawing tools and the shared zoom/pan of the boards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardState } from '../../src/engine/board.js';
import { Mask, maskBBox, rasterizeStrokes } from '../../src/engine/raster.js';
import { strokeJitter } from '../../src/engine/stroke.js';
import { Viewport, ZoomLimits } from '../../src/engine/viewport.js';
import { FigureLimits, fitDistance, halfFrameInRadius, lensZoom } from '../../src/engine/figure.js';
import { point } from '../../src/engine/types.js';

const inkOf = (m) => m.px.reduce((n, p) => n + (p ? 1 : 0), 0);
const line = (st, y, x0 = 100, x1 = 600) => {
  st.beginStroke(x0, y, 1);
  for (let x = x0 + 10; x <= x1; x += 10) st.addPoint(x, y, 1);
  st.endStroke();
};

test('TOOLS-PEN-WIDTH: the chosen width is drawn and kept per stroke', () => {
  const st = new BoardState();
  st.penWidth = 2;
  line(st, 100);
  st.penWidth = 16;
  line(st, 300);
  assert.equal(maskBBox(cropRow(st.user, 100)).height, 2);
  assert.ok(maskBBox(cropRow(st.user, 300)).height >= 15);
  const live = st.user.px.slice();
  st.rebuild(); // undo/redo path rasterizes from the stroke list
  assert.ok(Math.abs(inkOf(st.user) - live.reduce((n, p) => n + (p ? 1 : 0), 0)) < 300);
  assert.deepEqual(st.strokes.map((s) => s.width), [2, 16]);
});

/** Pixels within ±40 rows of y. */
function cropRow(m, y) {
  const out = new Mask(m.w, m.h);
  for (let yy = y - 40; yy <= y + 40; yy++) for (let x = 0; x < m.w; x++) if (m.at(x, yy)) out.set(x, yy);
  return out;
}

test('TOOLS-ERASER: erases ink, ignores pressure, survives rebuild and undo', () => {
  const st = new BoardState();
  line(st, 200);
  const full = inkOf(st.user);
  st.tool = 'eraser';
  st.eraserWidth = 20;
  st.beginStroke(350, 150, 0.1); // light pressure must not shrink the eraser
  st.addPoint(350, 250, 0.1);
  st.endStroke();
  assert.equal(st.user.at(350, 200), 0);
  assert.equal(st.user.at(320, 200), 255);
  const erased = inkOf(st.user);
  assert.ok(full - erased >= 18 * 6, 'about eraser width × line width removed');
  st.rebuild();
  assert.equal(inkOf(st.user), erased, 'erase strokes replay the same way');
  assert.ok(st.strokes[1].erase && st.strokes[1].points.every((p) => p.pressure === 1));
  st.undo();
  assert.equal(inkOf(st.user), full);
  // Erasing does not count as a shaky line.
  const zig = { erase: true, points: Array.from({ length: 20 }, (_, i) => point(i * 5, (i % 3) * 6)) };
  assert.equal(strokeJitter([zig]), 0);
  const m = new Mask(50, 50);
  rasterizeStrokes(m, [{ points: [point(10, 25), point(40, 25)], width: 6 }, { erase: true, width: 50, points: [point(25, 25)] }]);
  assert.equal(inkOf(m), 0);
});

test('TOOLS-VIEWPORT: zoom keeps the point under the pointer, pan stays on the paper', () => {
  const v = new Viewport(768);
  const side = 400;
  assert.deepEqual(v.toCanvas(200, 200, side), { x: 384, y: 384 });
  assert.deepEqual(v.toCanvas(0, 0, side), { x: 0, y: 0 });
  v.zoomAt(4, 100, 300, side);
  const p = v.toCanvas(100, 300, side);
  assert.ok(Math.abs(p.x - 192) < 1e-9 && Math.abs(p.y - 576) < 1e-9, 'anchor stays put');
  const d = v.toDisplay(p.x, p.y, side);
  assert.ok(Math.abs(d.x - 100) < 1e-9 && Math.abs(d.y - 300) < 1e-9);
  v.panBy(-10000, 0, side);
  assert.equal(v.toCanvas(side, 0, side).x, 768, 'cannot scroll past the right edge');
  v.zoomAt(1000, 0, 0, side);
  assert.equal(v.zoom, ZoomLimits[1]);
  v.zoomAt(1e-6, 0, 0, side);
  assert.deepEqual([v.zoom, v.cx, v.cy], [1, 384, 384], 'zoomed out fully is centred');
  v.panBy(50, 50, side);
  assert.deepEqual([v.cx, v.cy], [384, 384], 'nothing to pan at 100%');
});

test('FIGURE-ZOOM: close-ups crop with the lens instead of moving into the model', () => {
  assert.ok(FigureLimits.zoomPct[1] >= 800 && FigureLimits.zoomPct[0] <= 20);
  assert.equal(fitDistance(1, 35, 800), fitDistance(1, 35, 100));
  assert.equal(lensZoom(800), 8);
  assert.equal(lensZoom(50), 1);
  assert.ok(fitDistance(1, 35, 50) > fitDistance(1, 35, 100) * 1.99);
  assert.ok(fitDistance(1, 15, 800) > 1, 'camera stays outside the bounding sphere');
  assert.ok(Math.abs(halfFrameInRadius(35, 800) * 8 - halfFrameInRadius(35, 100)) < 1e-9);
});
