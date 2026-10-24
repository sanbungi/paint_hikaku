import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const outputDir = path.resolve(process.env.PAINT_HIKAKU_TEST_OUTPUT ?? path.join(root, 'test-results', 'gui'));

/** Launches the real app with an isolated data directory. */
export async function launch(t, extraArgs = []) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paint-hikaku-gui-'));
  // Containers and Ubuntu 24.04 runners cannot use Chromium's setuid/userns sandbox.
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
  const app = await _electron.launch({
    args: ['.', ...sandbox, ...extraArgs],
    cwd: root,
    env: { ...process.env, PAINT_HIKAKU_DATA_DIR: dataDir },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  t.after(async () => {
    if (t.passed === false) await shot(app, `${slug(t.name)}-failure`).catch(() => {});
    await app.close().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await page.waitForFunction(() => window.__paintHikaku);
  await page.evaluate(() => window.__paintHikaku.firstFrame);
  await setSize(app, page, 1366, 768);
  return { app, page, dataDir, errors };
}

export async function setSize(app, page, width, height, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, [w, h, z]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(w, h);
    win.webContents.setZoomFactor(z);
  }, [width, height, zoom]);
  await page.waitForFunction(([w, z]) => Math.abs(window.innerWidth - w / z) <= 2, [width, zoom]);
  await nextFrame(page);
}

export const nextFrame = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
}));

export const slug = (name) => name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');

/** Captures through Electron so zoomed (high-DPI) layouts are saved whole. */
export async function shot(app, name) {
  await fs.mkdir(outputDir, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  await fs.writeFile(path.join(outputDir, `${name}.png`), Buffer.from(base64, 'base64'));
}

/** RGBA of one pixel of a board in 768² scoring coordinates (independent of zoom). */
export function canvasPixel(page, id, x, y) {
  return page.evaluate(([role, px, py]) => window.__paintHikaku.pixel(role, px, py), [id, x, y]);
}

/** Drags across the paper; points are in 0..1 of the visible canvas square. */
export async function drawOnPaper(page, points) {
  const box = await page.locator('#paper').boundingBox();
  const side = Math.min(box.width, box.height);
  const at = ([u, v]) => [box.x + (box.width - side) / 2 + u * side, box.y + v * side];
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps: 4 });
  await page.mouse.up();
  await nextFrame(page);
}

export const state = (page) => page.evaluate(() => {
  const { session, board } = window.__paintHikaku;
  return {
    templateId: session.templateId,
    saved: session.saved,
    resultMode: board.resultMode,
    strokes: board.strokes.length,
    overlay: board.overlay,
    alignMode: board.alignMode,
    memoryMode: board.memoryMode,
    sampleVisible: board.sampleVisible,
    hasColor: board.tplColor !== null,
    perspective: session.perspective,
  };
});

export const text = (page, selector) => page.locator(selector).innerText();

export async function sessionFiles(dataDir) {
  try {
    return (await fs.readdir(path.join(dataDir, 'sessions'))).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
}
