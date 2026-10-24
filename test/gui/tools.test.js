// Pen / eraser / hand tools, pen width and colour, and zooming the boards, through real input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasPixel, drawOnPaper, launch, nextFrame, shot } from './helpers.js';

const board = (page) => page.evaluate(() => {
  const b = window.__paintHikaku.board;
  return {
    tool: b.tool, penWidth: b.penWidth, penColor: b.penColor,
    strokes: b.strokes.map((s) => ({ width: s.width, color: s.color ?? null, erase: Boolean(s.erase) })),
  };
});
const view = (page) => page.evaluate(() => {
  const v = window.__paintHikaku.viewport;
  return { zoom: v.zoom, cx: v.cx, cy: v.cy };
});
/** Ink rows crossing column x of the scoring mask. */
const inkRows = (page, x) => page.evaluate((cx) => {
  const u = window.__paintHikaku.board.user;
  const rows = [];
  for (let y = 0; y < u.h; y++) if (u.at(cx, y)) rows.push(y);
  return rows;
}, x);
/** What the user sees at a canvas point: reads the on-screen board canvas. */
const shown = (page, id, x, y) => page.evaluate(([cid, px, py]) => {
  const c = document.getElementById(cid);
  const p = window.__paintHikaku.viewport.toDisplay(px, py, c.width);
  return [...c.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data];
}, [id, x, y]);
const isRed = ([r, g, b]) => r > 150 && g < 90 && b < 100;

test('GUI-TOOLS: pen width and colour, eraser, zoom and hand', async (t) => {
  const { app, page, errors } = await launch(t);
  const pressed = (id) => page.locator(`#${id}`).getAttribute('aria-pressed');
  assert.equal(await pressed('toolPen'), 'true');

  // Width: a thin line and a thick line, kept per stroke.
  await page.locator('#penWidth').fill('2');
  assert.equal(await page.locator('#penWidthOut').innerText(), '2px');
  await drawOnPaper(page, [[0.1, 0.25], [0.9, 0.25]]);
  await page.locator('#penWidth').fill('16');
  await page.getByRole('button', { name: '赤' }).click();
  await drawOnPaper(page, [[0.1, 0.5], [0.9, 0.5]]);
  let b = await board(page);
  assert.deepEqual(b.strokes.map((s) => s.width), [2, 16]);
  assert.deepEqual(b.strokes.map((s) => s.color), ['#1c1c20', '#c8323c']);
  const rows = await inkRows(page, 384);
  const thin = rows.filter((y) => y < 300).length;
  const thick = rows.filter((y) => y > 300).length;
  assert.ok(thin <= 3 && thick >= 15, `thin ${thin}px, thick ${thick}px`);
  assert.ok(isRed(await shown(page, 'paper', 384, 384)), 'drawn in the chosen colour');
  assert.deepEqual(await canvasPixel(page, 'paper', 384, 384), [28, 28, 32, 255], 'scoring ignores colour');

  // Eraser cuts the thick line; undo brings it back.
  await page.keyboard.press('e');
  assert.equal(await pressed('toolEraser'), 'true');
  await drawOnPaper(page, [[0.5, 0.35], [0.5, 0.65]]);
  assert.equal((await board(page)).strokes.at(-1).erase, true);
  assert.equal((await inkRows(page, 384)).filter((y) => y > 300).length, 0);
  assert.deepEqual((await shown(page, 'paper', 384, 384)).slice(0, 3), [255, 255, 255]);
  assert.ok(isRed(await shown(page, 'paper', 200, 384)), 'the rest of the line stays');
  await page.locator('#paper').focus();
  await page.keyboard.press('Control+z');
  assert.ok((await inkRows(page, 384)).filter((y) => y > 300).length >= 15);
  await page.keyboard.press('b');
  assert.equal(await pressed('toolPen'), 'true');

  // Zoom: both boards show the same enlarged region; strokes map through the zoom.
  await page.getByRole('button', { name: '拡大' }).click();
  await page.getByRole('button', { name: '拡大' }).click();
  assert.equal((await view(page)).zoom, 1.5625);
  assert.equal(await page.locator('#zoomLevel').innerText(), '156%');
  await nextFrame(page);
  const [r, g, bl] = await shown(page, 'sample', 558, 558); // on the circle template, 45° down-right
  assert.ok(bl > 150 && r < 120 && g < 150, `sample circle at the same place, got ${[r, g, bl]}`);
  await page.locator('#penWidth').fill('6');
  await drawOnPaper(page, [[0.4, 0.8], [0.6, 0.8]]);
  const span = await page.evaluate(() => {
    const s = window.__paintHikaku.board.strokes.at(-1).points;
    return [Math.min(...s.map((p) => p.x)), Math.max(...s.map((p) => p.x)), s[0].y];
  });
  const expected = (0.2 * 768) / 1.5625;
  assert.ok(Math.abs(span[1] - span[0] - expected) < 4, `zoomed stroke spans ${span[1] - span[0]} (≈${expected})`);
  assert.ok(Math.abs(span[2] - (384 + (0.3 * 768) / 1.5625)) < 4);
  await shot(app, 'tools-zoomed');

  // Hand: drags the view, never draws. Space+drag does the same with the pen.
  const strokes = (await board(page)).strokes.length;
  await page.getByRole('button', { name: '手のひら' }).click();
  const before = await view(page);
  await drawOnPaper(page, [[0.5, 0.5], [0.3, 0.5]]);
  const after = await view(page);
  assert.ok(after.cx > before.cx + 20, 'dragging left shows more of the right');
  assert.equal((await board(page)).strokes.length, strokes);
  await page.getByRole('button', { name: 'ペン' }).click();
  await page.keyboard.down('Space');
  await drawOnPaper(page, [[0.5, 0.5], [0.5, 0.3]]);
  await page.keyboard.up('Space');
  assert.ok((await view(page)).cy > after.cy + 20);
  assert.equal((await board(page)).strokes.length, strokes);

  // Wheel zooms around the pointer on either board; 全体 and Ctrl+0 fit again.
  const box = await page.locator('#sample').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  assert.ok((await view(page)).zoom > 1.6);
  await page.getByRole('button', { name: '全体' }).click();
  assert.deepEqual(await view(page), { zoom: 1, cx: 384, cy: 384 });
  await page.getByRole('button', { name: '拡大' }).click();
  await page.locator('#paper').focus();
  await page.keyboard.press('Control+0');
  assert.equal((await view(page)).zoom, 1);
  assert.deepEqual(errors, []);
});
