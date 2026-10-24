// Drives the real Electron window through DOM events (mouse, keyboard, clicks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canvasPixel, drawOnPaper, launch, nextFrame, root, sessionFiles, setSize, shot, state, text,
} from './helpers.js';

const perspDisabled = (page) => page.locator('#perspBox').evaluate((el) => el.disabled);
const line = [[0.2, 0.5], [0.4, 0.5], [0.6, 0.5], [0.8, 0.5]];

test('GUI-EVENTS: choose, draw, check, save, align, compare, retry', async (t) => {
  const { app, page, dataDir, errors } = await launch(t);

  await page.getByRole('option', { name: '矩形' }).click();
  assert.equal((await state(page)).templateId, 'rect');
  assert.equal(await page.getByRole('option', { name: '矩形' }).getAttribute('aria-selected'), 'true');

  await drawOnPaper(page, line);
  assert.equal((await state(page)).strokes, 1);
  assert.deepEqual(await canvasPixel(page, 'paper', 384, 384), [28, 28, 32, 255]);
  assert.deepEqual(await canvasPixel(page, 'sample', 384, 384), [250, 249, 245, 255], 'sample must not show user ink');

  await page.getByRole('button', { name: '記録' }).click();
  assert.equal(await text(page, '#status'), '先に答え合わせしてください。');

  await page.getByRole('button', { name: '答え合わせ' }).click();
  assert.ok((await state(page)).resultMode);
  assert.match(await text(page, '#diag'), /参考 IoU \d\.\d\d/);
  await nextFrame(page);
  assert.deepEqual(await canvasPixel(page, 'sample', 384, 384), [210, 60, 70, 255], 'user ink in overlay red');

  await page.getByRole('button', { name: '記録' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent === '記録しました。');
  assert.equal((await sessionFiles(dataDir)).length, 1);
  assert.equal(await page.locator('#history li').count(), 1);
  assert.match(await text(page, '#trend'), /矩形 {2}1回/);

  await page.getByRole('button', { name: '記録' }).click();
  assert.equal(await text(page, '#status'), 'この結果は記録済みです。');
  assert.equal((await sessionFiles(dataDir)).length, 1);

  await page.getByLabel('重心で位置合わせ（形だけ見る）').check();
  assert.equal((await state(page)).alignMode, 'centroid');
  await page.getByRole('button', { name: '記録' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent === '記録しました。');
  const files = await sessionFiles(dataDir);
  assert.equal(files.length, 2);
  const saved = await Promise.all(files.map(async (f) => JSON.parse(
    await fs.readFile(path.join(dataDir, 'sessions', f), 'utf8'))));
  assert.deepEqual(saved.map((r) => r.alignMode).sort(), ['centroid', 'none']);

  await page.getByLabel('比較方式').selectOption('wipe');
  assert.ok(await page.locator('#wipeSlider').isVisible());
  await page.locator('#wipeSlider').getByRole('button', { name: '1つ増やす' }).click();
  assert.equal(await page.evaluate(() => window.__paintHikaku.board.wipePct), 51);
  await page.getByLabel('比較方式').selectOption('heat');
  assert.equal((await state(page)).overlay, 'heat');
  await shot(app, 'events-heat');

  await page.getByRole('button', { name: 'もう一度' }).click();
  const again = await state(page);
  assert.ok(!again.resultMode && again.strokes === 0 && !again.saved);

  await drawOnPaper(page, line);
  await drawOnPaper(page, [[0.5, 0.2], [0.5, 0.8]]);
  await page.locator('#paper').focus();
  await page.keyboard.press('Control+z');
  assert.equal((await state(page)).strokes, 1);
  await page.keyboard.press('Control+Enter');
  assert.ok((await state(page)).resultMode);
  assert.deepEqual(errors, []);
});

test('GUI-MEMORY: hidden sample, peek for about two seconds', async (t) => {
  const { page } = await launch(t);
  const hidden = [232, 230, 224, 255];
  assert.ok(await page.getByRole('button', { name: 'チラ見' }).isDisabled());
  await page.getByLabel('記憶模写').check();
  await nextFrame(page);
  assert.deepEqual(await canvasPixel(page, 'sample', 10, 10), hidden);
  await page.getByRole('button', { name: 'チラ見' }).click();
  await nextFrame(page);
  assert.notDeepEqual(await canvasPixel(page, 'sample', 10, 10), hidden);
  await page.waitForFunction(() => !window.__paintHikaku.board.sampleVisible, null, { timeout: 4000 });
  await nextFrame(page);
  assert.deepEqual(await canvasPixel(page, 'sample', 10, 10), hidden);
  await drawOnPaper(page, line);
  await page.getByRole('button', { name: '答え合わせ' }).click();
  assert.ok((await state(page)).sampleVisible, 'result shows the sample');
});

test('GUI-PERSPECTIVE: sliders, steps and bounds', async (t) => {
  const { app, page } = await launch(t);
  assert.ok(await perspDisabled(page), 'flat shapes disable perspective');
  await page.getByRole('option', { name: '立方体' }).click();
  assert.ok(!(await perspDisabled(page)));
  const yaw = page.locator('#perspBox .slider[data-key="yawDeg"]');
  await yaw.getByRole('button', { name: '1つ増やす' }).click();
  assert.equal((await state(page)).perspective.yawDeg, 33);
  assert.match(await yaw.innerText(), /水平角 33°/);
  assert.match(await text(page, '#status'), /パース:2点\s+水平33°/);
  await yaw.getByRole('slider').fill('70');
  await yaw.getByRole('button', { name: '1つ増やす' }).click();
  assert.equal((await state(page)).perspective.yawDeg, 70);
  const dist = page.locator('#perspBox .slider[data-key="dist"]');
  await dist.getByRole('slider').fill('1');
  await dist.getByRole('button', { name: '1つ減らす' }).click();
  assert.equal((await state(page)).perspective.dist, 1);
  for (const mode of ['onePoint', 'threePoint', 'isometric']) {
    await page.getByLabel('投影').selectOption(mode);
    assert.equal((await state(page)).perspective.mode, mode);
  }
  await drawOnPaper(page, line);
  await page.getByLabel('補助線').uncheck();
  assert.equal((await state(page)).strokes, 1, 'perspective tweaks keep the drawing');
  await shot(app, 'perspective-isometric');
});

async function writeJpeg(page, file, width, height) {
  const bytes = await page.evaluate(async ([w, h]) => {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(220 30 30)';
    ctx.fillRect(0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, [width, height]);
  await fs.writeFile(file, Buffer.from(bytes));
}

test('GUI-IMAGES: PNG/JPEG, Japanese paths, aspect ratio, broken and missing files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '絵 お手本-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const png = path.join(dir, '家 の 線画.png');
  await fs.copyFile(path.join(root, 'assets', 'sample_house.png'), png);
  const broken = path.join(dir, '壊れた.png');
  await fs.writeFile(broken, 'not an image');

  await t.test('PNG from the command line', async (t2) => {
    const { page } = await launch(t2, [png]);
    await page.waitForFunction(() => window.__paintHikaku.board.tplColor !== null);
    const s = await state(page);
    assert.equal(s.templateId, `image:${png}`);
    assert.equal(await page.getByRole('option', { name: '外部画像…' }).getAttribute('aria-selected'), 'true');
    assert.ok(await perspDisabled(page));
  });

  await t.test('JPEG keeps colour and aspect ratio', async (t2) => {
    const jpeg = path.join(dir, '横長 写真.jpg');
    const { page: p1 } = await launch(t2);
    await writeJpeg(p1, jpeg, 400, 200);
    const { page } = await launch(t2, [jpeg]);
    await page.waitForFunction(() => window.__paintHikaku.board.tplColor !== null);
    await nextFrame(page);
    const [r, g, b] = await canvasPixel(page, 'sample', 384, 384);
    assert.ok(r > 180 && g < 80 && b < 80, `centre should be red, got ${[r, g, b]}`);
    assert.deepEqual(await canvasPixel(page, 'sample', 384, 20), [250, 249, 245, 255], 'letterbox is paper');
    assert.ok(!(await state(page)).strokes);
    assert.equal(await page.evaluate(() => {
      const { board } = window.__paintHikaku;
      return board.tpl.px[384 * 768 + 384];
    }), 255, 'scoring uses luma: this red (87) counts as ink');
  });

  await t.test('broken and missing files keep the current template', async (t2) => {
    for (const [file, message] of [[broken, /画像を読めませんでした/], [path.join(dir, 'ない.png'), /ファイルがありません/]]) {
      const { page } = await launch(t2, [file]);
      await page.waitForFunction(() => !document.getElementById('status').textContent.startsWith('位置合わせなし'));
      assert.match(await text(page, '#status'), message);
      assert.equal((await state(page)).templateId, 'circle');
    }
  });

  await t.test('drop an image file onto the window', async (t2) => {
    const { page } = await launch(t2);
    await drawOnPaper(page, line);
    const bytes = [...await fs.readFile(png)];
    await page.evaluate((data) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, bytes);
    await page.waitForFunction(() => window.__paintHikaku.session.templateId === 'image:dropped.png');
    assert.equal((await state(page)).strokes, 0, 'a new template starts a clean paper');
  });

  await t.test('sample image button', async (t2) => {
    const { page } = await launch(t2);
    await page.getByRole('button', { name: 'サンプル画像' }).click();
    await page.waitForFunction(() => window.__paintHikaku.session.templateId === 'image:sample_house');
    assert.ok((await state(page)).hasColor);
  });
});

test('GUI-LAYOUT: sizes × zoom × arrangement keep both boards visible', async (t) => {
  const { app, page } = await launch(t);
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    for (const zoom of [1, 1.25, 1.5, 2]) {
      for (const layout of ['row', 'column']) {
        await page.getByLabel('配置').selectOption(layout);
        await setSize(app, page, w, h, zoom);
        const name = `layout-${w}x${h}-z${zoom}-${layout}`;
        await shot(app, name);
        const m = await page.evaluate(() => {
          const r = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
          const sides = ['left', 'right'].map((id) => {
            const el = document.getElementById(id);
            return { hidden: el.hidden, overflow: el.scrollWidth - el.clientWidth };
          });
          return {
            sample: r('sample'), paper: r('paper'), sides,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            bodyOverflow: document.body.scrollHeight - window.innerHeight,
          };
        });
        for (const id of ['sample', 'paper']) {
          assert.ok(m[id].width >= 80 && Math.abs(m[id].width - m[id].height) < 1.5, `${name}: ${id} square ${JSON.stringify(m[id])}`);
        }
        const overlap = !(m.sample.right <= m.paper.left || m.paper.right <= m.sample.left
          || m.sample.bottom <= m.paper.top || m.paper.bottom <= m.sample.top);
        assert.ok(!overlap, `${name}: boards overlap`);
        assert.ok(m.pageOverflow <= 1 && m.bodyOverflow <= 1, `${name}: page scrolls ${JSON.stringify(m)}`);
        for (const s of m.sides) assert.ok(s.hidden || s.overflow <= 0, `${name}: sidebar overflows sideways`);
        if (w / zoom < 1000) assert.ok(m.sides.every((s) => s.hidden), `${name}: compact hides sidebars`);
      }
    }
  }
  // In compact mode the two panels take turns.
  await setSize(app, page, 900, 700);
  await page.getByRole('button', { name: '題材・設定' }).click();
  await page.getByRole('button', { name: '診断' }).click();
  assert.deepEqual(await page.evaluate(() => ['left', 'right'].map((id) => document.getElementById(id).hidden)), [true, false]);
});
