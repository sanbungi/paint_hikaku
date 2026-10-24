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
/** Waits until the coalesced re-render for a view change has landed. */
const settled = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)));
}));

test('GUI-FIGURE: mannequin, poses, camera placement, display', async (t) => {
  const { app, page, errors } = await launch(t);
  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await waitTemplate(page, /^figure:mannequin#stand$/);
  assert.ok(await page.locator('#figureBox').isVisible());
  assert.ok(!(await page.locator('#perspBox').isVisible()), 'solid perspective panel hides for figures');
  assert.ok((await tplInk(page)) > 3000, 'mannequin has scoring lines');
  assert.ok((await state(page)).hasColor, 'shaded sample');
  assert.match(await text(page, '#status'), /デッサン人形・立ち/);
  await shot(app, 'figure-stand');

  const hashes = new Set([await tplHash(page)]);
  for (const pose of ['walk', 'sit', 'run']) {
    await page.getByLabel('ポーズ').selectOption(pose);
    await waitTemplate(page, new RegExp(`#${pose}$`));
    hashes.add(await tplHash(page));
  }
  assert.equal(hashes.size, 4, 'each pose draws different lines');

  // Camera changes keep the drawing; a new pose starts a clean paper.
  await drawOnPaper(page, [[0.3, 0.3], [0.7, 0.7]]);
  const before = await tplHash(page);
  await page.locator('#figureBox .slider[data-key="yawDeg"]').getByRole('button', { name: '1つ増やす' }).click();
  await settled(page);
  assert.equal((await figureView(page)).yawDeg, 26);
  assert.notEqual(await tplHash(page), before);
  assert.equal((await state(page)).strokes, 1);

  const box = await page.locator('#sample').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await settled(page);
  const dragged = await figureView(page);
  assert.equal(dragged.yawDeg, 76, 'drag left turns the model');
  assert.equal(dragged.pitchDeg, 20, 'drag down looks from above');
  assert.match(await page.locator('#figureBox .slider[data-key="yawDeg"]').innerText(), /向き 76°/);

  await page.mouse.wheel(0, -100);
  await settled(page);
  assert.ok((await figureView(page)).zoomPct > 100);

  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.getByLabel('床グリッドと目線（採点対象外）').uncheck();
  await settled(page);
  assert.ok((await state(page)).resultMode, 'guide-only change keeps the result');
  await page.getByLabel('見本の表示').selectOption('lines');
  await settled(page);
  assert.ok(!(await state(page)).hasColor && (await state(page)).resultMode);
  const withCreases = await tplInk(page);
  await page.getByLabel('内部の線も採点する').uncheck();
  await settled(page);
  assert.ok((await tplInk(page)) < withCreases, 'outline only has fewer lines');
  assert.ok(!(await state(page)).resultMode, 'new lines need a new check');
  assert.equal((await state(page)).strokes, 1);

  await page.getByLabel('ポーズ').selectOption('crouch');
  await waitTemplate(page, /#crouch$/);
  assert.equal((await state(page)).strokes, 0);
  await page.getByRole('button', { name: '答え合わせ' }).click();
  await page.getByRole('button', { name: '記録' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent === '記録しました。');
  assert.match(await text(page, '#history'), /デッサン人形・しゃがみ/);
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
    await waitTemplate(page, /^figure:.*\.vrm#stand$/);
    assert.equal((await state(page)).templateId, `figure:${vrm}#stand`);
    assert.ok((await tplInk(page)) > 1000);
    assert.equal(await page.getByRole('option', { name: 'VRM モデル…' }).getAttribute('aria-selected'), 'true');
    assert.match(await text(page, '#figureCredit'), /テスト人形（paint_hikaku tests）/);
    const standing = await tplHash(page);
    await page.getByLabel('ポーズ').selectOption('tpose');
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
    await waitTemplate(page, /^figure:dropped\.vrm#stand$/);
    await drawOnPaper(page, [[0.2, 0.5], [0.8, 0.5]]);
    await drop('broken.vrm', await fs.readFile(broken));
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('VRM を読めませんでした'));
    const s = await state(page);
    assert.equal(s.templateId, 'figure:dropped.vrm#stand');
    assert.equal(s.strokes, 1);
    // Back to the mannequin after a VRM.
    await page.getByRole('option', { name: 'デッサン人形' }).click();
    await waitTemplate(page, /^figure:mannequin#stand$/);
    await nextFrame(page);
    assert.equal(await text(page, '#figureCredit'), '');
  });
});
