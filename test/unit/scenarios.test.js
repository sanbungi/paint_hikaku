// State and pixel scenarios; IDs match tests/README in the D version and test/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AlignMode, CanvasSize, OverlayMode } from '../../src/engine/types.js';
import { Mask, composeOverlay, composeSample, composeWipe, maskCentroid } from '../../src/engine/raster.js';
import { compareMasks } from '../../src/engine/compare.js';
import { builtinCatalog, renderBuiltin, renderTemplate } from '../../src/engine/templates.js';
import { PerspModes, defaultPerspective } from '../../src/engine/perspective.js';
import { practiceGuides } from '../../src/engine/grid.js';
import { PracticeSession } from '../../src/engine/session.js';
import { BoardRenderer } from '../../src/engine/view.js';
import { formatTrend, nowIso, parseRecord, trendFor } from '../../src/engine/trend.js';
import { dataRoot, loadRecent, saveSession } from '../../src/main/history.js';

function session(records = []) {
  return new PracticeSession({
    writeRecord: async (r) => { records.push(r); },
    timestamp: () => '2026-01-01T000000Z',
  });
}

test('STATE-SAVE', async () => {
  const records = [];
  const s = session(records);
  s.select('circle');
  assert.equal(await s.save(), false);
  s.board.beginStroke(100, 100, 1);
  s.board.addPoint(150, 100, 1);
  s.board.endStroke();
  s.check();
  assert.equal(await s.save(), true);
  s.check();
  assert.equal(await s.save(), false);
  assert.equal(records.length, 1);
  const ink = s.board.user.px.slice();
  s.setAlignment(AlignMode.centroid);
  assert.ok(!s.saved);
  assert.equal(await s.save(), true);
  assert.equal(records[1].alignMode, 'centroid');
  assert.deepEqual(s.board.user.px, ink);
  s.board.overlay = OverlayMode.heat;
  assert.equal(await s.save(), false);
  s.clear();
  assert.ok(!s.board.resultMode && !s.saved);
});

test('STATE-SAVE-RETRY', async () => {
  const s = session();
  s.select('circle');
  s.check();
  s.writeRecord = async () => { throw new Error('disk full'); };
  await assert.rejects(s.save(), /disk full/);
  assert.ok(!s.saved);
  s.writeRecord = async () => {};
  assert.equal(await s.save(), true);
});

test('STATE-SAVE-CONCURRENT: a double click writes one record', async () => {
  const records = [];
  const s = session(records);
  let release;
  s.writeRecord = (r) => new Promise((resolve) => { release = () => { records.push(r); resolve(); }; });
  s.select('circle');
  s.check();
  const first = s.save();
  assert.equal(await s.save(), false);
  release();
  assert.equal(await first, true);
  assert.equal(records.length, 1);
});

test('STATE-IMAGE-PERSPECTIVE', () => {
  const s = session();
  const image = renderBuiltin('circle', CanvasSize, 3);
  const pixels = composeSample(image, new Mask());
  s.setTemplate('image:C:\\絵\\sample.png', image, new Mask(), pixels);
  s.board.beginStroke(80, 80, 1);
  const before = s.board.user.px.slice();
  s.adjustPerspective({ ...defaultPerspective(), dist: 1 });
  assert.equal(s.board.tpl, image);
  assert.equal(s.board.tplColor, pixels);
  assert.deepEqual(s.board.user.px, before);
});

test('STATE-PEEK', () => {
  const s = session();
  s.memory(true);
  assert.ok(!s.board.sampleVisible);
  const first = s.peek();
  const second = s.peek();
  s.expirePeek(first);
  assert.ok(s.board.sampleVisible);
  s.expirePeek(second);
  assert.ok(!s.board.sampleVisible);
  const stale = s.peek();
  s.select('circle');
  assert.ok(!s.board.sampleVisible);
  const active = s.peek();
  s.expirePeek(stale);
  assert.ok(s.board.sampleVisible);
  s.expirePeek(active);
  s.check();
  assert.ok(s.board.sampleVisible);
  s.clear();
  assert.ok(!s.board.sampleVisible);
});

test('CATALOG-PERSPECTIVE', () => {
  for (const t of builtinCatalog()) {
    for (const mode of PerspModes) {
      for (const dist of [1, 55, 90]) {
        const r = renderTemplate(t.id, { ...defaultPerspective(), mode, dist }, 96);
        assert.equal(r.ink.px.length, 96 * 96, t.id);
        // At the closest distance the camera may be inside the object.
        if (dist === 55) assert.ok(maskCentroid(r.ink).count > 0, `${t.id} ${mode}`);
      }
    }
  }
});

test('GUIDES-NONSCORING', () => {
  const s = session();
  s.select('circle');
  const ink = s.board.tpl.px.slice();
  for (const n of [0, 2, 3, 4]) {
    practiceGuides(CanvasSize, n, s.board.tpl, true);
    assert.deepEqual(s.board.tpl.px, ink);
    assert.equal(compareMasks(s.board.tpl, s.board.tpl).iou, 1);
  }
  // Guides are drawn on screen but never touch the scoring masks.
  s.board.gridN = 4;
  s.board.showBBox = true;
  new BoardRenderer(s.board).sample();
  assert.deepEqual(s.board.tpl.px, ink);
});

test('STATE-PERSPECTIVE-GUIDES', async () => {
  const s = session();
  s.select('solid_cube');
  s.board.beginStroke(90, 90, 1);
  s.check();
  await s.save();
  const ink = s.board.user.px.slice();
  const p = { ...s.perspective };
  p.showGuides = !p.showGuides;
  p.showHidden = !p.showHidden;
  s.adjustPerspective(p);
  assert.ok(s.saved && s.board.resultMode);
  s.adjustPerspective({ ...p, yawDeg: p.yawDeg + 20 });
  assert.ok(!s.saved && !s.board.resultMode);
  assert.deepEqual(s.board.user.px, ink);
});

test('COMPARE-PIXELS', () => {
  const t = new Mask(4, 1);
  const u = new Mask(4, 1);
  t.set(0, 0);
  t.set(1, 0);
  u.set(1, 0);
  u.set(2, 0);
  assert.deepEqual([...composeOverlay(t, u, OverlayMode.overlay)],
    [50, 90, 210, 255, 40, 170, 90, 255, 210, 60, 70, 255, 245, 245, 242, 255]);
  const diff = composeOverlay(t, u, OverlayMode.diff);
  assert.deepEqual([...diff.slice(0, 4)], [40, 80, 200, 255]);
  assert.deepEqual([...diff.slice(8, 12)], [220, 40, 40, 255]);
  const heat = composeOverlay(t, u, OverlayMode.heat, new Float32Array([0, 0, 24, 48]));
  assert.deepEqual([...heat.slice(4, 8)], [40, 180, 50, 255]);
  assert.deepEqual([...heat.slice(8, 12)], [240, 20, 50, 255]);
  const met = compareMasks(t, u);
  assert.ok(Math.abs(met.iou - 1 / 3) < 1e-5);
  assert.equal(met.missRate, 0.5);
  assert.equal(met.extraRate, 0.5);
  const empty = compareMasks(t, new Mask(4, 1));
  assert.ok(empty.iou === 0 && empty.missRate === 1 && Number.isFinite(empty.dx));
  const wide = new Mask(10, 1);
  wide.px.fill(255);
  assert.deepEqual([...composeWipe(wide, wide, new Mask(10, 1), 0).slice(16, 20)], [200, 50, 60, 255]);
  assert.deepEqual([...composeWipe(wide, wide, new Mask(10, 1), 100).slice(16, 20)], [50, 90, 210, 255]);
});

test('HISTORY-PATHS', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paint-hikaku-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const r = {
    isoTime: '2026-01-01T00:00:00Z',
    templateId: 'image:C:\\日本語 folder\\image.png',
    alignMode: 'none',
    metrics: { iou: 0.25 },
    commentsJa: ['テスト'],
  };
  await saveSession(r, root);
  await saveSession(r, root);
  const records = await loadRecent(24, root);
  assert.equal(records.length, 2);
  assert.equal(records[0].templateId, r.templateId);
  assert.equal(records[0].metrics.iou, 0.25);
  assert.deepEqual(records[0].commentsJa, ['テスト']);
  for (const name of await fs.readdir(root)) assert.doesNotMatch(name, /[:\\]/);
  await fs.writeFile(path.join(root, 'broken.json'), '{');
  await fs.writeFile(path.join(root, 'legacy.json'),
    '{"isoTime":"old","templateId":"circle","alignMode":"none","metrics":{"iou":0.5}}');
  assert.equal((await loadRecent(24, root)).length, 3);
  // The limit keeps the newest file names (legacy.json sorts last).
  assert.deepEqual((await loadRecent(1, root)).map((x) => x.templateId), ['circle']);
  assert.deepEqual(await loadRecent(24, path.join(root, 'missing')), []);
});

test('HISTORY-ROOT: same data directory as the D version', () => {
  assert.equal(dataRoot({ PAINT_HIKAKU_DATA_DIR: '/x' }, 'linux'), '/x');
  assert.equal(dataRoot({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32'),
    path.join('C:\\Users\\a\\AppData\\Roaming', 'paint_hikaku'));
  assert.equal(dataRoot({ HOME: '/home/a' }, 'linux'), path.join('/home/a', '.local', 'share', 'paint_hikaku'));
  assert.equal(dataRoot({ HOME: '/home/a', XDG_DATA_HOME: '/data' }, 'linux'), path.join('/data', 'paint_hikaku'));
});

test('HISTORY-TREND', () => {
  const tmp = parseRecord('{"isoTime":"t","templateId":"circle","alignMode":"none","commentsJa":["x"],"metrics":{"iou":0.5}}');
  assert.equal(tmp.templateId, 'circle');
  assert.equal(tmp.metrics.iou, 0.5);
  assert.throws(() => parseRecord('{"templateId":"circle"}'));
  const rec = (dx, scaleRatio, iou) => ({ templateId: 'circle', metrics: { dx, dy: 0, scaleRatio, iou, jitter: 0 } });
  const tr = trendFor([rec(30, 0.7, 0.2), rec(20, 0.8, 0.4)], 'circle');
  assert.equal(tr.n, 2);
  assert.match(tr.habitJa, /右に寄る/);
  assert.match(tr.habitJa, /小さめ/);
  assert.match(formatTrend(tr, '円'), /円 {2}2回 {2}平均IoU 0\.30 {2}前回比 IoU \+0\.20/);
  assert.equal(formatTrend(trendFor([], 'circle'), '円'), 'この題材の記録はまだありません。');
  assert.equal(nowIso(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '2026-01-02T030405Z');
});
