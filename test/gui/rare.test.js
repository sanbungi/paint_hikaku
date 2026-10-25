// Less frequent paths that broke silently before: pen eraser tip, stuck Space, undo mid-stroke,
// monitor scale changes, GPU resets, middle-button pan, diagnosis after re-framing, long histories,
// switching back to a loaded VRM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drawOnPaper, launch, nextFrame, state, text } from './helpers.js';
import { buildTestVrm } from '../fixtures/vrm.js';

/** Dispatches pen pointer events at 0..1 positions of the visible paper. */
function pen(page, points, { button = 0, buttons = 1, pressure = 0.5 } = {}) {
  return page.evaluate(([pts, opt]) => {
    const paper = document.getElementById('paper');
    const r = paper.getBoundingClientRect();
    const fire = (type, [u, v], extra = {}) => paper.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
      clientX: r.left + u * r.width, clientY: r.top + v * r.height, pressure: opt.pressure, ...extra,
    }));
    fire('pointerdown', pts[0], { button: opt.button, buttons: opt.buttons });
    for (const p of pts.slice(1)) fire('pointermove', p, { button: -1, buttons: opt.buttons });
    fire('pointerup', pts.at(-1), { button: opt.button, buttons: 0, pressure: 0 });
  }, [points, { button, buttons, pressure }]);
}
const strokes = (page) => page.evaluate(() => window.__paintHikaku.board.strokes
  .map((s) => ({ erase: Boolean(s.erase), pressures: s.points.map((p) => p.pressure) })));
const inkAt = (page, x, y) => page.evaluate(([px, py]) => window.__paintHikaku.board.user.at(px, py), [x, y]);

test('GUI-RARE-PEN: pressure, eraser tip, undo mid-stroke, stuck Space', async (t) => {
  const { page, errors } = await launch(t);
  await pen(page, [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]], { pressure: 0.6 });
  let s = await strokes(page);
  assert.equal(s.length, 1);
  assert.ok(Math.abs(s[0].pressures[0] - (0.2 + 1.35 * 0.6)) < 1e-6, 'pen pressure drives the width');
  assert.equal(await inkAt(page, 384, 384), 255);

  // Flipping the pen to its eraser end erases although the pen tool is selected.
  await pen(page, [[0.5, 0.4], [0.5, 0.6]], { button: 5, buttons: 32 });
  s = await strokes(page);
  assert.ok(s[1].erase, 'eraser tip makes an erase stroke');
  assert.equal(await inkAt(page, 384, 384), 0);
  assert.equal(await page.evaluate(() => window.__paintHikaku.board.tool), 'pen', 'the chosen tool is kept');

  // Ctrl+Z while the pen is down must not remove the previous stroke under the pen.
  const box = await page.locator('#paper').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.2, { steps: 4 });
  await page.keyboard.press('Control+z');
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.2, { steps: 4 });
  await page.mouse.up();
  assert.equal((await strokes(page)).length, 3);

  // Space held while the window loses focus (Alt+Tab) must not leave the hand stuck on.
  await page.locator('#paper').focus();
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await drawOnPaper(page, [[0.2, 0.8], [0.8, 0.8]]);
  await page.keyboard.up('Space');
  assert.equal((await strokes(page)).length, 4, 'drawing works again after focus returns');

  // Middle button pans instead of drawing.
  await page.getByRole('button', { name: '拡大' }).click();
  const cx = await page.evaluate(() => window.__paintHikaku.viewport.cx);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  assert.ok((await page.evaluate(() => window.__paintHikaku.viewport.cx)) > cx);
  assert.equal((await strokes(page)).length, 4);
  assert.deepEqual(errors, []);
});

test('GUI-RARE-DISPLAY: monitor scale change re-renders, GPU reset recovers', async (t) => {
  const { app, page, errors } = await launch(t);
  const width = () => page.evaluate(() => document.getElementById('paper').width);
  const before = await width();
  const cdp = await page.context().newCDPSession(page);
  const size = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  // Same CSS size, twice the device pixels: what moving to a 200% monitor does.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 2, mobile: false });
  await page.waitForFunction((w) => document.getElementById('paper').width >= w * 1.9, before);
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));
  const lose = await page.evaluate(() => {
    const ext = window.__paintHikaku.figure.studio.renderer.getContext().getExtension('WEBGL_lose_context');
    ext.loseContext();
    window.__restore = () => ext.restoreContext();
    return true;
  });
  assert.ok(lose);
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => /GPU がリセット/.test(document.getElementById('status').textContent));
  assert.ok((await state(page)).templateId === 'circle', 'nothing half-rendered');
  await page.evaluate(() => window.__restore());
  await page.waitForFunction(() => /復帰/.test(document.getElementById('status').textContent));
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => window.__paintHikaku.session.templateId.startsWith('figure:'));
  const ink = await page.evaluate(() => window.__paintHikaku.board.tpl.px.reduce((n, p) => n + (p ? 1 : 0), 0));
  assert.ok(ink > 2000, `renders again after the reset (${ink})`);
  void app;
  assert.deepEqual(errors, []);
});

test('GUI-RARE-DIAG: results stay consistent when the template is re-framed', async (t) => {
  const { page, errors } = await launch(t);
  // Perspective change on a checked solid: the drawing stays, the old result is kept as 加筆中.
  await page.getByRole('option', { name: '立方体' }).click();
  await drawOnPaper(page, [[0.3, 0.3], [0.7, 0.7]]);
  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.locator('#perspBox .slider[data-key="yawDeg"]').getByRole('button', { name: '1つ増やす' }).click();
  let s = await state(page);
  assert.ok(!s.resultMode && s.strokes === 1);
  assert.match(await text(page, '#diag'), /加筆中[\s\S]*参考 IoU/);
  // A guide-only change keeps the result and re-scores it.
  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.getByLabel('補助線').uncheck();
  s = await state(page);
  assert.ok(s.resultMode);
  assert.doesNotMatch(await text(page, '#diag'), /加筆中/);

  // 3D: re-baking the same view after a check shows the result, not the adjust instruction.
  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await drawOnPaper(page, [[0.4, 0.2], [0.4, 0.8]]);
  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.getByRole('button', { name: '構図・ポーズを変える' }).click();
  assert.ok(await page.locator('#adjustHint').isVisible());
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('adjusting'));
  assert.ok((await state(page)).resultMode, 'unchanged framing keeps the result');
  assert.match(await text(page, '#diag'), /参考 IoU/);
  assert.ok(!(await page.locator('#adjustHint').isVisible()));
  // Re-framed: the drawing stays and the earlier result is marked 加筆中.
  await page.getByRole('button', { name: '構図・ポーズを変える' }).click();
  await page.locator('#figureCamera .slider[data-key="yawDeg"]').getByRole('button', { name: '1つ増やす' }).click();
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('adjusting'));
  s = await state(page);
  assert.ok(!s.resultMode && s.strokes === 1);
  assert.match(await text(page, '#diag'), /加筆中[\s\S]*参考 IoU/);
  assert.deepEqual(errors, []);
});

test('GUI-RARE-HISTORY-VRM: long histories keep their trend; a loaded VRM is kept', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paint-hikaku-vrm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const vrm = path.join(dir, 'kept.vrm');
  await fs.writeFile(vrm, buildTestVrm('保持テスト'));
  const { page, dataDir, errors } = await launch(t, [vrm]);
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));

  // 30 old circle records followed by 30 newer line records: the circle trend must count all 30.
  const sessions = path.join(dataDir, 'sessions');
  await fs.mkdir(sessions, { recursive: true });
  const write = (i, templateId) => fs.writeFile(path.join(sessions, `2025-01-${String(i).padStart(2, '0')}T000000Z_${templateId}_${i}.json`),
    JSON.stringify({ isoTime: `2025-01-${i}`, templateId, alignMode: 'none', metrics: { iou: 0.3, scaleRatio: 1 } }));
  for (let i = 1; i <= 30; i++) await write(i, 'circle');
  await fs.writeFile(path.join(sessions, 'z.json'), '{');
  for (let i = 31; i <= 60; i++) {
    await fs.writeFile(path.join(sessions, `2026-01-01T0000${String(i).padStart(2, '0')}Z_line_${i}.json`),
      JSON.stringify({ isoTime: `2026-${i}`, templateId: 'line', alignMode: 'none', metrics: { iou: 0.5 } }));
  }
  await page.getByRole('option', { name: '円', exact: true }).click();
  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.getByRole('button', { name: '記録' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent === '記録しました。');
  assert.equal(await page.locator('#history li').count(), 24, 'the list stays short');
  assert.match(await text(page, '#trend'), /円 {2}31回/, 'the trend sees the whole history');

  // The VRM loaded at start-up survives a detour to the mannequin.
  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));
  await page.getByRole('option', { name: 'VRM モデル…' }).click();
  await page.waitForFunction(() => /保持テスト/.test(document.getElementById('figureCredit').textContent));
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => window.__paintHikaku.session.templateId.endsWith('kept.vrm#stand'));
  await nextFrame(page);
  assert.deepEqual(errors, []);
});
