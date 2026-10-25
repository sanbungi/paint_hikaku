// The pose editor window: full-body IK with the mouse, saving poses, sending them to the app,
// landmarks → pose, VRM models and running on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { launch, nextFrame, root, state, text } from './helpers.js';
import { buildTestVrm } from '../fixtures/vrm.js';

const bake = async (page) => {
  await page.getByRole('button', { name: 'この構図で描く' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('adjusting'));
};

async function openEditor(app, page) {
  const [editor] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: /ポーズエディタ/ }).click(),
  ]);
  const errors = [];
  editor.on('pageerror', (e) => errors.push(e));
  await editor.waitForFunction(() => window.__poseEditor);
  await editor.evaluate(() => window.__poseEditor.ready);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('ポーズエディタ'));
    win.setContentSize(1200, 800);
  });
  await editor.waitForFunction(() => window.innerWidth >= 1190);
  await nextFrame(editor);
  return { editor, errors };
}

const handle = (editor, id) => editor.evaluate((h) => window.__poseEditor.handleScreen(h), id);
const handles = (editor) => editor.evaluate(() => window.__poseEditor.state.poser.handlePositions());
const bones = (editor) => editor.evaluate(() => window.__poseEditor.state.poser.toPoseData().bones);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function dragHandle(editor, id, dx, dy, { shift = false } = {}) {
  const p = await handle(editor, id);
  await editor.mouse.move(p.x, p.y);
  if (shift) await editor.keyboard.down('Shift');
  await editor.mouse.down();
  await editor.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
  await editor.mouse.up();
  if (shift) await editor.keyboard.up('Shift');
  await nextFrame(editor);
}

test('GUI-POSE-EDITOR: drag joints with full-body IK, save, and use the pose in the app', async (t) => {
  const { app, page, dataDir, errors } = await launch(t);
  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));
  const { editor, errors: editorErrors } = await openEditor(app, page);
  assert.match(await text(editor, '#status'), /デッサン人形 を編集中/);
  assert.equal((await editor.evaluate(() => window.__poseEditor.state.selected)), null);
  await editor.getByRole('button', { name: '正面' }).click();

  // Hand: follows the mouse, the rest of the body stays.
  const h0 = await handles(editor);
  await dragHandle(editor, 'leftHand', 0, -120);
  const h1 = await handles(editor);
  assert.ok(h1.leftHand[1] > h0.leftHand[1] + 0.2, 'hand went up');
  assert.ok(dist(h1.rightHand, h0.rightHand) < 1e-6 && dist(h1.leftFoot, h0.leftFoot) < 1e-6, 'other limbs stay');
  assert.match(await text(editor, '#selName'), /左手/);

  // Hips down: a crouch over the pinned feet.
  await dragHandle(editor, 'hips', 0, 90);
  const h2 = await handles(editor);
  assert.ok(h2.hips[1] < h1.hips[1] - 0.15, 'hips went down');
  assert.ok(dist(h2.leftFoot, h1.leftFoot) < 1e-3 && dist(h2.rightFoot, h1.rightFoot) < 1e-3, 'feet stay planted');
  const b = await bones(editor);
  assert.ok(b.leftLowerLeg[0] > 30 && b.rightLowerLeg[0] > 30, 'knees bend');

  // Shift-drag turns the head.
  await dragHandle(editor, 'head', 60, 0, { shift: true });
  assert.ok(Math.abs((await bones(editor)).head?.[1] ?? 0) > 10, 'head turned');

  // Undo / redo with keys.
  await editor.keyboard.press('Control+z');
  assert.ok(Math.abs((await bones(editor)).head?.[1] ?? 0) < 1, 'undo');
  await editor.keyboard.press('Control+y');
  assert.ok(Math.abs((await bones(editor)).head?.[1] ?? 0) > 10, 'redo');

  // Pin a hand by double-clicking it; moving the hips keeps it in place.
  const rh = await handle(editor, 'rightHand');
  await editor.mouse.dblclick(rh.x, rh.y);
  assert.equal(await editor.evaluate(() => window.__poseEditor.state.poser.pins.rightHand), true);
  assert.ok(await editor.getByLabel(/ピン留め/).isChecked(), 'the panel shows the pin');
  const before = await handles(editor);
  // Toward the hand: a straight arm can bend to stay, not stretch.
  await dragHandle(editor, 'hips', -25, 0);
  assert.ok(dist((await handles(editor)).rightHand, before.rightHand) < 1e-3, 'pinned hand stays');

  // Mirror swaps sides.
  const pre = await bones(editor);
  await editor.getByRole('button', { name: '左右反転' }).click();
  const mir = await bones(editor);
  assert.ok(Math.abs(mir.rightUpperArm[2] + pre.leftUpperArm[2]) < 0.5, 'mirrored arm');
  await editor.getByRole('button', { name: '左右反転' }).click();

  // Angle sliders change the selected bone directly.
  await editor.getByLabel('角度を直接いじるボーン').selectOption('neck');
  await editor.locator('#angles input[data-axis="2"]').fill('20');
  assert.ok(Math.abs((await bones(editor)).neck[2] - 20) < 0.6, 'slider sets the angle');

  // Save: the pose goes to <data>/poses.json and into the app's pose list.
  await editor.getByLabel('名前').fill('かがんで手を挙げる');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitForFunction(() => document.getElementById('status').textContent.includes('保存しました'));
  const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'poses.json'), 'utf8'));
  assert.equal(stored.poses.length, 1);
  assert.equal(stored.poses[0].labelJa, 'かがんで手を挙げる');
  assert.match(stored.poses[0].id, /^user:/);
  await page.waitForFunction(() => [...document.querySelectorAll('#pose option')].some((o) => o.textContent === 'かがんで手を挙げる'));

  // Use it in the app: the main window gets it and bakes it like any pose.
  await editor.getByRole('button', { name: 'メイン画面で使う' }).click();
  await page.waitForFunction(() => window.__paintHikaku.figure.poseId.startsWith('user:'));
  assert.equal(await page.locator('#pose').evaluate((s) => s.selectedOptions[0].textContent), 'かがんで手を挙げる');
  await bake(page);
  assert.match((await state(page)).templateId, /^figure:mannequin#user:/);
  assert.match(await text(page, '#status'), /デッサン人形・かがんで手を挙げる/);
  const ink = await page.evaluate(() => window.__paintHikaku.board.tpl.px.reduce((n, p) => n + (p ? 1 : 0), 0));
  assert.ok(ink > 2000, 'the custom pose has scoring lines');

  // Re-saving the same pose updates the app (the live view poses again).
  await page.getByRole('button', { name: '構図・ポーズを変える' }).click();
  await nextFrame(page);
  const oldBones = await page.evaluate(() => JSON.stringify(window.__paintHikaku.figure.studio.posed?.data.bones));
  await dragHandle(editor, 'rightFoot', 40, -60);
  await editor.getByRole('button', { name: 'メイン画面で使う' }).click();
  await page.waitForFunction((old) => {
    const p = window.__paintHikaku.figure.studio.posed;
    return p && JSON.stringify(p.data.bones) !== old;
  }, oldBones);
  const again = JSON.parse(await fs.readFile(path.join(dataDir, 'poses.json'), 'utf8'));
  assert.equal(again.poses.length, 1, 'overwritten, not duplicated');

  // Reopening brings the same window back with the main window's pose.
  await page.getByRole('button', { name: /ポーズエディタ/ }).click();
  await editor.waitForFunction(() => document.getElementById('poseName').value === 'かがんで手を挙げる');
  assert.equal(app.windows().length, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(editorErrors, []);
});

/** Landmarks of someone with both arms raised in a "Y" (MediaPipe world coordinates). */
function armsUpLandmarks() {
  const pts = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
  const set = (i, x, y, z = 0) => { pts[i] = { x, y, z, visibility: 0.95 }; };
  set(0, 0, -0.62, -0.1); set(7, 0.07, -0.64, 0); set(8, -0.07, -0.64, 0);
  set(11, 0.18, -0.5); set(12, -0.18, -0.5);
  set(13, 0.33, -0.72); set(14, -0.33, -0.72);
  set(15, 0.45, -0.95); set(16, -0.45, -0.95);
  set(17, 0.48, -1.03, 0.02); set(18, -0.48, -1.03, 0.02); set(19, 0.47, -1.03, -0.02); set(20, -0.47, -1.03, -0.02);
  set(23, 0.1, 0); set(24, -0.1, 0);
  set(25, 0.11, 0.42); set(26, -0.11, 0.42);
  set(27, 0.11, 0.82); set(28, -0.11, 0.82);
  set(29, 0.11, 0.86, 0.04); set(30, -0.11, 0.86, 0.04);
  set(31, 0.11, 0.88, -0.12); set(32, -0.11, 0.88, -0.12);
  return pts;
}

test('GUI-POSE-IMAGE: landmarks become a pose; the image tools wait for the model', async (t) => {
  const vrmDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pose-vrm-'));
  t.after(() => fs.rm(vrmDir, { recursive: true, force: true }));
  const vrm = path.join(vrmDir, 'テスト 人形.vrm');
  await fs.writeFile(vrm, buildTestVrm());
  const { app, page } = await launch(t, [vrm]);
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));
  const { editor, errors } = await openEditor(app, page);
  // The editor poses the app's VRM, not the mannequin.
  assert.match(await editor.locator('#modelName').textContent(), /テスト人形/);
  assert.ok(await editor.getByRole('button', { name: '推定してポーズにする' }).isDisabled(), 'needs a model and an image');
  assert.ok(await editor.getByRole('button', { name: 'モデルをダウンロード' }).isVisible());

  // Drag works on the VRM's rig too.
  await editor.getByRole('button', { name: '正面' }).click();
  const v0 = await handles(editor);
  await dragHandle(editor, 'rightHand', -40, -100);
  assert.ok((await handles(editor)).rightHand[1] > v0.rightHand[1] + 0.15, 'VRM hand moved');

  await editor.evaluate((lm) => window.__poseEditor.applyLandmarks(lm), armsUpLandmarks());
  const h = await handles(editor);
  assert.ok(h.leftHand[1] > h.head[1] && h.rightHand[1] > h.head[1], 'both hands above the head');
  assert.ok(h.leftHand[0] * h.rightHand[0] < 0, 'hands on opposite sides');
  assert.match(await text(editor, '#status'), /画像からポーズを作りました/);

  // Mirroring the photo swaps which hand is which.
  const before = await handles(editor);
  await editor.evaluate((lm) => window.__poseEditor.applyLandmarks(lm, { mirror: true }), armsUpLandmarks());
  const after = await handles(editor);
  assert.ok(Math.abs(after.leftHand[0] + before.rightHand[0]) < 0.02, 'mirrored');

  // An image without a model: shown as a reference, detection still disabled.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 60);
    const g = c.getContext('2d');
    g.fillStyle = '#888';
    g.fillRect(0, 0, 40, 60);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())];
  });
  await editor.evaluate((d) => window.__poseEditor.openImageBytes(new Uint8Array(d), 'gray.png'), png);
  assert.ok(await editor.locator('#refPanel').isVisible());
  assert.match(await text(editor, '#status'), /ポーズモデルを用意すると推定できます/);
  assert.ok(await editor.getByRole('button', { name: '推定してポーズにする' }).isDisabled());
  assert.deepEqual(errors, []);
});

test('GUI-POSE-STANDALONE: --pose-editor runs on its own and still saves poses', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paint-hikaku-pose-'));
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
  const app = await _electron.launch({
    args: ['.', ...sandbox, '--pose-editor'],
    cwd: root,
    env: { ...process.env, PAINT_HIKAKU_DATA_DIR: dataDir },
    timeout: 60_000,
  });
  t.after(async () => {
    await app.close().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const editor = await app.firstWindow();
  const errors = [];
  editor.on('pageerror', (e) => errors.push(e));
  await editor.waitForFunction(() => window.__poseEditor);
  await editor.evaluate(() => window.__poseEditor.ready);
  assert.equal(app.windows().length, 1);
  assert.match(await editor.locator('#modelName').textContent(), /デッサン人形/);
  await editor.locator('#builtinPoses').selectOption('run');
  assert.ok((await bones(editor)).leftLowerLeg[0] > 60, 'sample pose loaded');
  await editor.getByRole('button', { name: 'メイン画面で使う' }).click();
  await editor.waitForFunction(() => document.getElementById('status').textContent.includes('メイン画面は開いていません'));
  const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'poses.json'), 'utf8'));
  assert.equal(stored.poses.length, 1);
  assert.deepEqual(errors, []);
});

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

test('GUI-POSE-UNDERDRAWING: export the posed figure as an underdrawing (PNG, layers, clipboard)', async (t) => {
  const { app, page } = await launch(t);
  await page.getByRole('option', { name: 'デッサン人形' }).click();
  await page.waitForFunction(() => document.body.classList.contains('adjusting'));
  const { editor, errors } = await openEditor(app, page);
  const out = await fs.mkdtemp(path.join(os.tmpdir(), '下絵 test-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  await editor.locator('#builtinPoses').selectOption('walk');
  await editor.getByLabel('名前').fill('歩く');
  await editor.locator('#exportBox summary').click();

  // Every layer has ink; the figure fills the crop when fitting.
  for (const id of ['silhouette', 'box3d', 'skeleton']) await editor.locator(`#udLayers input[data-layer="${id}"]`).check();
  const all = await editor.evaluate(() => window.__poseEditor.underdrawing(512));
  assert.deepEqual([all.width, all.height], [384, 512], 'portrait 3:4');
  for (const id of ['shaded', 'silhouette', 'floor', 'box3d', 'bbox', 'skeleton', 'lines']) {
    assert.ok(all.counts[id] > 100, `${id} has ink (${all.counts[id]})`);
  }
  assert.ok(all.counts.silhouette > 384 * 512 * 0.12, `fit crop fills the frame (${all.counts.silhouette})`);
  await editor.locator('#udFraming').selectOption('view');
  assert.ok(await editor.locator('#exportFrame').isVisible(), 'the export frame shows on the view');
  const inView = await editor.evaluate(() => window.__poseEditor.underdrawing(512));
  assert.ok(inView.counts.silhouette < all.counts.silhouette, 'the view frame shows more around the figure');
  await editor.locator('#udFraming').selectOption('fit');
  assert.ok(!(await editor.locator('#exportFrame').isVisible()));
  await editor.waitForFunction(() => document.getElementById('udPreview').width > 0);

  // One PNG at the chosen size.
  await editor.getByLabel('大きさ（長辺）').selectOption('1024');
  const file = path.join(out, '歩く.png');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, file);
  await editor.getByRole('button', { name: 'PNG で保存…' }).click();
  await editor.waitForFunction(() => document.getElementById('status').textContent.includes('下絵を保存しました'));
  assert.deepEqual(pngSize(await fs.readFile(file)), { width: 768, height: 1024 });

  // One PNG per layer in a new folder each time.
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, out);
  for (let i = 0; i < 2; i++) {
    await editor.getByRole('button', { name: 'レイヤーごとに保存…' }).click();
    await editor.waitForFunction(() => /レイヤーを \d+ 枚保存しました/.test(document.getElementById('status').textContent));
    await editor.evaluate(() => { document.getElementById('status').textContent = ''; });
  }
  const files = (await fs.readdir(path.join(out, '歩く'))).sort();
  assert.deepEqual(files, [
    '00 合成.png', '01 陰影.png', '02 シルエット.png', '03 床と目線.png', '04 外接箱（立体）.png',
    '05 外接箱（画面）.png', '06 骨格.png', '07 線画.png',
  ]);
  assert.ok((await fs.readdir(out)).includes('歩く (2)'), 'a second export does not overwrite the first');
  const layer = await fs.readFile(path.join(out, '歩く', '07 線画.png'));
  assert.deepEqual(pngSize(layer), { width: 768, height: 1024 });

  // Clipboard.
  await editor.getByRole('button', { name: 'コピー' }).click();
  await editor.waitForFunction(() => /クリップボード|書き出せません/.test(document.getElementById('status').textContent));
  assert.match(await text(editor, '#status'), /クリップボードにコピーしました/);
  const clip = await app.evaluate(async ({ clipboard, nativeImage }) => {
    const [item] = await clipboard.read();
    const blob = await item.getType('image/png');
    return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
  });
  assert.deepEqual(clip, { width: 768, height: 1024 });

  // Nothing to export.
  for (const input of await editor.locator('#udLayers input').all()) await input.uncheck();
  await editor.getByRole('button', { name: 'PNG で保存…' }).click();
  assert.match(await text(editor, '#status'), /1 つ以上選んで/);
  assert.deepEqual(errors, []);
});
