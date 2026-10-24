// 3D figure templates: pose data, line extraction from G-buffers, ids, and the session contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mask, maskBBox } from '../../src/engine/raster.js';
import { edgesFromBuffers, linearizeDepth, overlayLines } from '../../src/engine/edges.js';
import { Poses, poseById } from '../../src/engine/poses.js';
import {
  FigureLimits, MannequinKey, defaultFigureView, figureLabel, figureTemplateId, fitDistance, parseFigureId,
} from '../../src/engine/figure.js';
import { PracticeSession } from '../../src/engine/session.js';
import { renderBuiltin } from '../../src/engine/templates.js';

const HumanBones = new Set([
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
]);
const inkOf = (m) => m.px.reduce((n, p) => n + (p ? 1 : 0), 0);

/** A w×h buffer set with a square object (depth `d`) covering [x0, x1) × [y0, y1). */
function scene(w, h, squares) {
  const depth = new Float32Array(w * h).fill(Infinity);
  const coverage = new Uint8Array(w * h);
  const normals = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) normals[i * 3 + 2] = 1;
  for (const { x0, y0, x1, y1, d, n = [0, 0, 1] } of squares) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        depth[i] = d;
        coverage[i] = 1;
        normals.set(n, i * 3);
      }
    }
  }
  return { w, h, depth, coverage, normals };
}

test('FIGURE-POSES: every sample pose uses VRM humanoid bones with sane angles', () => {
  assert.ok(Poses.length >= 6);
  assert.equal(new Set(Poses.map((p) => p.id)).size, Poses.length);
  for (const p of Poses) {
    assert.ok(p.labelJa, p.id);
    for (const [bone, angles] of Object.entries(p.bones)) {
      assert.ok(HumanBones.has(bone), `${p.id}: ${bone}`);
      assert.equal(angles.length, 3);
      for (const a of angles) assert.ok(Number.isFinite(a) && Math.abs(a) <= 180, `${p.id}.${bone}`);
    }
  }
  assert.equal(poseById('missing').id, Poses[0].id);
});

test('FIGURE-EDGES: silhouette of a square, lines sit on the object', () => {
  const ink = edgesFromBuffers(scene(40, 40, [{ x0: 10, y0: 10, x1: 30, y1: 30, d: 3 }]), { radius: 0.5 });
  const b = maskBBox(ink);
  assert.deepEqual([b.x0, b.y0, b.x1, b.y1], [10, 10, 29, 29]);
  assert.equal(ink.at(20, 20), 0, 'flat inside has no line');
  assert.equal(ink.at(10, 20), 255);
  assert.equal(inkOf(ink), 4 * 19);
});

test('FIGURE-EDGES: occlusion by depth jump, crease by normal turn, both optional', () => {
  const occluded = scene(40, 40, [{ x0: 0, y0: 0, x1: 40, y1: 40, d: 4 }, { x0: 10, y0: 10, x1: 20, y1: 20, d: 3 }]);
  const ink = edgesFromBuffers(occluded, { radius: 0.5 });
  assert.equal(ink.at(10, 15), 255, 'nearer square outlined');
  assert.equal(ink.at(9, 15), 0, 'line on the front surface');
  // Gradual depth change (a slanted plane) is not a line.
  const slope = scene(40, 1, [{ x0: 0, y0: 0, x1: 40, y1: 1, d: 3 }]);
  slope.depth.forEach((_, i) => { slope.depth[i] = 3 + i * 0.01; });
  assert.equal(inkOf(edgesFromBuffers(slope, { radius: 0.5 })), 0);

  const fold = scene(40, 40, [
    { x0: 0, y0: 0, x1: 20, y1: 40, d: 3, n: [0.7071, 0, 0.7071] },
    { x0: 20, y0: 0, x1: 40, y1: 40, d: 3, n: [-0.7071, 0, 0.7071] },
  ]);
  assert.equal(edgesFromBuffers(fold, { radius: 0.5 }).at(19, 20), 255);
  assert.equal(edgesFromBuffers(fold, { radius: 0.5, creaseDeg: 0 }).at(19, 20), 0);
  assert.equal(edgesFromBuffers({ ...fold, normals: null }, { radius: 0.5 }).at(19, 20), 0);
});

test('FIGURE-EDGES: lines are thin but solid (about 2.5 px)', () => {
  const square = () => scene(40, 40, [{ x0: 10, y0: 10, x1: 30, y1: 30, d: 3 }]);
  const thin = edgesFromBuffers(square(), { radius: 0.5 });
  const line = edgesFromBuffers(square());
  const ratio = inkOf(line) / inkOf(thin);
  assert.ok(ratio > 2 && ratio < 3.5, `default width ${ratio.toFixed(2)}× a 1 px outline`);
  // A horizontal cut through the left edge: two to three pixels of ink, no gaps.
  const row = [...Array(40).keys()].filter((x) => line.at(x, 20));
  assert.ok(row.includes(10) && row.length >= 4 && row.length <= 6, JSON.stringify(row));
});

test('FIGURE-DEPTH: depth buffer values become camera distances', () => {
  assert.ok(Math.abs(linearizeDepth(0, 1, 10) - 1) < 1e-9);
  assert.ok(Math.abs(linearizeDepth(1, 1, 10) - 10) < 1e-9);
  const mid = linearizeDepth(0.5, 1, 10);
  assert.ok(mid > 1 && mid < 5.5, 'perspective depth is non-linear');
});

test('FIGURE-OVERLAY: scoring lines tint the shaded sample, the rest is untouched', () => {
  const color = new Uint8ClampedArray([200, 200, 200, 255, 10, 20, 30, 255]);
  const ink = new Mask(2, 1);
  ink.set(0, 0);
  const out = overlayLines(color, ink);
  assert.deepEqual([...out.slice(4)], [10, 20, 30, 255]);
  assert.ok(out[2] > out[0], 'blue tint');
  assert.deepEqual([...color.slice(0, 3)], [200, 200, 200], 'input not modified');
});

test('FIGURE-IDS: template ids, labels and camera fit', () => {
  const id = figureTemplateId(MannequinKey, 'walk');
  assert.deepEqual(parseFigureId(id), { modelKey: MannequinKey, poseId: 'walk' });
  assert.equal(figureLabel(id), 'デッサン人形・歩き');
  const vrm = figureTemplateId('C:\\モデル\\あいう.vrm', 'sit');
  assert.equal(parseFigureId(vrm).modelKey, 'C:\\モデル\\あいう.vrm');
  assert.equal(figureLabel(vrm), 'あいう.vrm・座り（椅子）');
  assert.equal(parseFigureId('circle'), null);
  assert.ok(fitDistance(1, 30, 100) > fitDistance(1, 60, 100), 'telephoto stands further back');
  assert.ok(Math.abs(fitDistance(1, 60, 200) - 1) < 1e-9);
  const v = defaultFigureView();
  for (const [key, [lo, hi]] of Object.entries(FigureLimits)) assert.ok(v[key] >= lo && v[key] <= hi, key);
});

test('STATE-FIGURE-VIEW: a new camera angle keeps the drawing, display-only changes keep the result', async () => {
  const records = [];
  const s = new PracticeSession({ writeRecord: async (r) => { records.push(r); }, timestamp: () => 't' });
  const front = renderBuiltin('circle');
  const side = renderBuiltin('ellipse');
  const color = new Uint8ClampedArray(768 * 768 * 4);
  s.setTemplate(figureTemplateId(MannequinKey, 'stand'), front, new Mask(), color);
  s.board.beginStroke(100, 100, 1);
  s.board.endStroke();
  s.check();
  assert.equal(await s.save(), true);
  const ink = s.board.user.px.slice();

  const guides = new Mask();
  guides.set(1, 1);
  s.adjustTemplate(front, guides, null); // e.g. floor guide or display mode
  assert.ok(s.saved && s.board.resultMode);
  assert.equal(s.board.guides, guides);
  assert.equal(s.board.tplColor, null);

  s.adjustTemplate(side, new Mask(), color); // the camera moved
  assert.ok(!s.saved && !s.board.resultMode);
  assert.equal(s.board.tpl, side);
  assert.deepEqual(s.board.user.px, ink);
});
