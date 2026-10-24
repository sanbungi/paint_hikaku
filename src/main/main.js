import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecent, saveSession, sessionDir } from './history.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..', '..');

/** Packaged: [exe, ...args]. Development: [electron, '.', ...args]. */
function parseArgs(argv) {
  const rest = argv.slice(app.isPackaged ? 1 : 2);
  const smoke = rest.includes('--smoke-test');
  const imagePath = rest.find((a) => !a.startsWith('-')) ?? null;
  return { smoke, imagePath: imagePath ? path.resolve(imagePath) : null };
}

const args = parseArgs(process.argv);

if (args.smoke && !process.env.PAINT_HIKAKU_DATA_DIR) {
  console.error('Smoke tests require an isolated PAINT_HIKAKU_DATA_DIR');
  process.exit(2);
}

const ImageFilters = [
  { name: '画像', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] },
  { name: 'PNG', extensions: ['png'] },
];

async function readImage(filePath) {
  const data = await fs.readFile(filePath);
  return { path: filePath, name: path.basename(filePath), data: new Uint8Array(data) };
}

function registerIpc() {
  ipcMain.handle('app:args', () => args);
  ipcMain.handle('image:open', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'お手本画像を開く',
      properties: ['openFile'],
      filters: ImageFilters,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return readImage(result.filePaths[0]);
  });
  // Only the path given on the command line; the renderer cannot ask for arbitrary files.
  ipcMain.handle('image:initial', () => (args.imagePath ? readImage(args.imagePath) : null));
  ipcMain.handle('sample:read', () => readImage(path.join(appRoot, 'assets', 'sample_house.png')));
  ipcMain.handle('history:save', async (_event, record) => {
    await saveSession(record, sessionDir());
  });
  ipcMain.handle('history:load', () => loadRecent(24, sessionDir()));
  ipcMain.on('smoke:done', (_event, result) => {
    for (const line of result.log) console.log(line);
    if (!result.ok) console.error(result.error);
    app.exit(result.ok ? 0 : 1);
  });
}

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(1280, Math.floor(workAreaSize.width * 0.9)),
    height: Math.min(800, Math.floor(workAreaSize.height * 0.9)),
    minWidth: 640,
    minHeight: 480,
    title: 'paint_hikaku',
    backgroundColor: '#efede8',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links never open inside the app window.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, details) => {
    if (args.smoke) {
      console.error('renderer crashed', details.reason);
      app.exit(1);
    }
  });
  win.loadFile(path.join(appRoot, 'src', 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  if (args.smoke) {
    setTimeout(() => {
      console.error('TIMEOUT: smoke test did not finish');
      app.exit(1);
    }, 60_000);
  }
});

app.on('window-all-closed', () => app.quit());
