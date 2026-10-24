// 3D figure templates in the real window: mannequin, poses, camera placement, VRM loading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drawOnPaper, launch, nextFrame, shot, state, text } from './helpers.js';
import { buildTestVrm } from '../fixtures/vrm.js';

const tplInk = (page) => page.evaluate(() => window.__paintHikaku.board.tpl.px.reduce((n, p) => n + (p ? 1 : 0), 0));
const tplHash = (page) => page.evaluate(() => {
  let h = 0;
  const px = window.__paintHikaku.board.tpl.px;
  for (let i = 0; i < px.length; i++) if (px[i]) h = (h * 31 + i) % 1000000007;
  return h;
});
const figureView = (page) => page.evaluate(() => ({ ...window.__paintHikaku.figure.view }));
const waitTemplate = (page, re) => page.waitForFunction((src) => new RegExp(src).test(window.__paintHikaku.session.templateId), re.source);


const isVisible = (page, id) => page.locator(`#${id}`).isVisible();
const bake = async (page) => {
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('adjusting'));
};

test('GUI-FIGURE: adjust with a live view, then bake once and draw', async (t) => {
  const { app, page, errors } = await launch(t);
  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));
  assert.ok(await isVisible(page, 'live') && !(await isVisible(page, 'sample')), 'live 3D view replaces the sample');
  assert.ok(await isVisible(page, 'figureBox'));
  assert.ok(!(await isVisible(page, 'perspBox')), 'solid perspective panel hides for figures');
  assert.ok(await page.getByRole('button', { name: '答え合わせ' }).isDisabled(), 'paper is locked while adjusting');
  await drawOnPaper(page, [[0.3, 0.3], [0.7, 0.7]]);
  assert.equal((await state(page)).strokes, 0);
  assert.equal((await state(page)).templateId, 'circle', 'nothing is baked yet');
  await shot(app, 'figure-adjust');

  // Camera moves only redraw the live view.
  await page.locator('#figureCamera .slider[data-key="yawDeg"]').getByRole('button', { name: '1つ増やす' }).click();
  assert.equal((await figureView(page)).yawDeg, 26);
  const box = await page.locator('#live').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 100, cy + 40, { steps: 5 });
  await page.mouse.up();
  let v = await figureView(page);
  assert.deepEqual([v.yawDeg, v.pitchDeg], [76, 20], 'left drag turns and tilts');
  assert.match(await page.locator('#figureCamera .slider[data-key="yawDeg"]').innerText(), /向き 76°/);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + box.width / 4, cy, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  v = await figureView(page);
  assert.ok(Math.abs(v.panX + 0.5) < 0.02 && Math.abs(v.panY) < 0.02, `right drag pans (${v.panX}, ${v.panY})`);
  assert.deepEqual([v.yawDeg, v.pitchDeg], [76, 20], 'panning does not turn');
  await page.mouse.wheel(0, -100);
  await nextFrame(page);
  assert.ok((await figureView(page)).zoomPct > 100);
  assert.equal((await state(page)).templateId, 'circle');

  await bake(page);
  assert.equal((await state(page)).templateId, 'figure:mannequin#stand');
  assert.ok(await isVisible(page, 'sample') && !(await isVisible(page, 'live')));
  assert.ok(!(await isVisible(page, 'figureCamera')), 'camera controls hide while drawing');
  assert.ok((await tplInk(page)) > 2000, 'mannequin has scoring lines');
  assert.ok((await state(page)).hasColor, 'shaded sample');
  assert.match(await text(page, '#status'), /お手本: デッサン人形・立ち/);
  await shot(app, 'figure-baked');

  await drawOnPaper(page, [[0.3, 0.3], [0.7, 0.7]]);
  assert.equal((await state(page)).strokes, 1);
  await page.getByRole('button', { name: '答え合わせ' }).click();

  // Display options reuse the bake: the result survives guide/display changes.
  await page.getByLabel('床グリッドと目線（採点対象外）').uncheck();
  await nextFrame(page);
  assert.ok((await state(page)).resultMode);
  await page.getByLabel('見本の表示').selectOption('lines');
  await nextFrame(page);
  assert.ok(!(await state(page)).hasColor && (await state(page)).resultMode);
  const withCreases = await tplInk(page);
  await page.getByLabel('内部の線も採点する').uncheck();
  await page.waitForFunction((n) => window.__paintHikaku.board.tpl.px.reduce((a, p) => a + (p ? 1 : 0), 0) < n, withCreases);
  assert.ok(!(await state(page)).resultMode, 'new lines need a new check');

  // Re-framing the same pose keeps the drawing; a new pose starts a clean paper.
  const before = await tplHash(page);
  await page.getByRole('button', { name: '構図・ポーズを変える' }).click();
  await page.getByRole('button', { name: 'ずらしを戻す' }).click();
  assert.equal((await figureView(page)).panX, 0);
  await bake(page);
  assert.notEqual(await tplHash(page), before);
  assert.equal((await state(page)).strokes, 1);

  const hashes = new Set([await tplHash(page)]);
  for (const pose of ['walk', 'sit', 'crouch']) {
    await page.getByRole('button', { name: '構図・ポーズを変える' }).click();
    await page.getByLabel('ポーズ').selectOption(pose);
    await bake(page);
    await waitTemplate(page, new RegExp(`#${pose}$`));
    hashes.add(await tplHash(page));
  }
  assert.equal(hashes.size, 4, 'each pose draws different lines');
  assert.equal((await state(page)).strokes, 0);
  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.getByRole('button', { name: '記録' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent === '記録しました。');
  assert.match(await text(page, '#history'), /デッサン人形・しゃがみ/);

  // Choosing a flat shape leaves the figure step.
  await page.getByRole('option', { name: '円', exact: true }).click();
  assert.ok(!(await isVisible(page, 'figureBox')) && await isVisible(page, 'sample'));
  assert.deepEqual(errors, []);
});

test('GUI-VRM: load from the command line and by drop, broken files keep the template', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'モデル vrm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const vrm = path.join(dir, 'テスト 人形.vrm');
  const bytes = buildTestVrm();
  await fs.writeFile(vrm, bytes);
  const broken = path.join(dir, '壊れた.vrm');
  await fs.writeFile(broken, 'glTF but not really');

  await t.test('command line', async (t2) => {
    const { app, page, errors } = await launch(t2, [vrm]);
    await page.waitForFunction(() => document.body.classList.contains('adjusting'));
    await bake(page);
    await waitTemplate(page, /^figure:.*\.vrm#stand$/);
    assert.equal((await state(page)).templateId, `figure:${vrm}#stand`);
    assert.ok((await tplInk(page)) > 1000);
    assert.equal(await page.getByRole('option', { name: 'VRM モデル…' }).getAttribute('aria-selected'), 'true');
    assert.match(await text(page, '#figureCredit'), /テスト人形（paint_hikaku tests）/);
    const standing = await tplHash(page);
    await page.getByRole('button', { name: '構図・ポーズを変える' }).click();
    await page.getByLabel('ポーズ').selectOption('tpose');
    await bake(page);
    await waitTemplate(page, /#tpose$/);
    assert.notEqual(await tplHash(page), standing, 'poses move the VRM bones');
    await shot(app, 'figure-vrm-tpose');
    assert.deepEqual(errors, []);
  });

  await t.test('drop, then a broken model', async (t2) => {
    const { page } = await launch(t2);
    const drop = (name, data) => page.evaluate(([n, d]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(d)], n));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [name, [...data]]);
    await drop('dropped.vrm', bytes);
    await page.waitForFunction(() => document.body.classList.contains('adjusting'));
    await bake(page);
    await waitTemplate(page, /^figure:dropped\.vrm#stand$/);
    await drawOnPaper(page, [[0.2, 0.5], [0.8, 0.5]]);
    await drop('broken.vrm', await fs.readFile(broken));
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('VRM を読めませんでした'));
    const s = await state(page);
    assert.equal(s.templateId, 'figure:dropped.vrm#stand');
    assert.equal(s.strokes, 1);
    // Back to the mannequin after a VRM.
    await page.getByRole('option', { name: 'デッサン人形' }).click();
    await bake(page);
    await waitTemplate(page, /^figure:mannequin#stand$/);
    assert.equal(await text(page, '#figureCredit'), '');
  });
});
