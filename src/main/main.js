import { app, BrowserWindow, dialog, ipcMain, Menu, net, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecent, saveSession, sessionDir } from './history.js';
import { loadUserPoses, saveUserPoses } from './userposes.js';
import { downloadPoseModel, importPoseModel, readPoseModel } from './posemodel.js';
import { validatePose } from '../engine/poses.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..', '..');

/** Packaged: [exe, ...args]. Development: [electron, '.', ...args]. */
function parseArgs(argv) {
  const rest = argv.slice(app.isPackaged ? 1 : 2);
  const smoke = rest.includes('--smoke-test');
  const poseEditor = rest.includes('--pose-editor');
  const imagePath = rest.find((a) => !a.startsWith('-')) ?? null;
  return { smoke, poseEditor, imagePath: imagePath ? path.resolve(imagePath) : null };
}

const args = parseArgs(process.argv);

// 3D figures need WebGL. Without a usable GPU (VMs, remote desktops, CI) Chromium only offers
// its software renderer behind this switch; the app shows local content only, never web pages.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

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

const windows = { main: null, editor: null };
// What the pose editor edits: the main window's model and pose (null = mannequin, standing).
let editorContext = null;

const broadcast = (channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
};

const senderIs = (event, key) => windows[key] && event.sender === windows[key].webContents;

async function openFileOf(event, title, filters) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readImage(result.filePaths[0]);
}

/** The pose editor: a separate window that only talks to the app through these channels. */
function registerPoseEditorIpc() {
  ipcMain.handle('editor:open', (event, context) => {
    if (!senderIs(event, 'main')) return false;
    editorContext = context ?? null;
    if (windows.editor) {
      windows.editor.webContents.send('editor:context', editorContext);
      if (windows.editor.isMinimized()) windows.editor.restore();
      windows.editor.focus();
    } else {
      createEditorWindow();
    }
    return true;
  });
  ipcMain.handle('editor:context', () => editorContext);
  // Editor → main window. False when the editor runs on its own (--pose-editor).
  ipcMain.handle('editor:send', (event, pose) => {
    if (!senderIs(event, 'editor') || !windows.main) return false;
    windows.main.webContents.send('pose:from-editor', validatePose(pose));
    return true;
  });
  ipcMain.handle('poses:list', () => loadUserPoses());
  ipcMain.handle('poses:save', async (_event, list) => {
    const saved = await saveUserPoses(list);
    broadcast('poses:changed', saved);
    return saved;
  });
  ipcMain.handle('pose:export', async (event, pose) => {
    const clean = validatePose(pose);
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'ポーズを書き出す',
      defaultPath: `${clean.labelJa.replace(/[\\/:*?"<>|]/g, '_')}.pose.json`,
      filters: [{ name: 'ポーズ', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, `${JSON.stringify({ format: 'paint_hikaku-pose', version: 1, ...clean }, null, 1)}\n`, 'utf8');
    return result.filePath;
  });
  ipcMain.handle('pose:import', async (event) => {
    const file = await openFileOf(event, 'ポーズを読み込む', [{ name: 'ポーズ', extensions: ['json'] }]);
    if (!file) return null;
    return validatePose(JSON.parse(Buffer.from(file.data).toString('utf8')));
  });
  ipcMain.handle('pose-image:open', (event) => openFileOf(event, 'ポーズの元にする画像を開く', ImageFilters));
  ipcMain.handle('posemodel:read', () => readPoseModel());
  ipcMain.handle('posemodel:download', (event) => downloadPoseModel(
    (url) => net.fetch(url),
    (ratio) => { if (!event.sender.isDestroyed()) event.sender.send('posemodel:progress', ratio); },
  ));
  ipcMain.handle('posemodel:choose', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'MediaPipe のポーズモデル（pose_landmarker_*.task）を選ぶ',
      properties: ['openFile'],
      filters: [{ name: 'MediaPipe モデル', extensions: ['task'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importPoseModel(result.filePaths[0]);
  });
}

function registerIpc() {
  registerPoseEditorIpc();
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
  ipcMain.handle('vrm:open', (event) => openFileOf(event, 'VRM モデルを開く', [{ name: 'VRM', extensions: ['vrm'] }]));
  // Only the path given on the command line; the renderer cannot ask for arbitrary files.
  ipcMain.handle('image:initial', () => (args.imagePath ? readImage(args.imagePath) : null));
  ipcMain.handle('sample:read', () => readImage(path.join(appRoot, 'assets', 'sample_house.png')));
  ipcMain.handle('history:save', async (_event, record) => {
    await saveSession(record, sessionDir());
  });
  // Trends use the whole history (bounded); the list shows only the newest entries.
  ipcMain.handle('history:load', () => loadRecent(1000, sessionDir()));
  ipcMain.on('smoke:done', (_event, result) => {
    for (const line of result.log) console.log(line);
    if (!result.ok) console.error(result.error);
    app.exit(result.ok ? 0 : 1);
  });
}

/** Same locked-down settings for both windows: local pages only, no Node in the page. */
function guard(win) {
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, details) => {
    if (args.smoke) {
      console.error('renderer crashed', details.reason);
      app.exit(1);
    }
  });
}

function createEditorWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(1240, Math.floor(workAreaSize.width * 0.85)),
    height: Math.min(820, Math.floor(workAreaSize.height * 0.9)),
    minWidth: 760,
    minHeight: 520,
    title: 'ポーズエディタ - paint_hikaku',
    backgroundColor: '#efede8',
    show: false,
    webPreferences: {
      preload: path.join(here, 'pose-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  guard(win);
  win.on('closed', () => { windows.editor = null; });
  win.loadFile(path.join(appRoot, 'src', 'renderer', 'pose-editor', 'index.html'));
  windows.editor = win;
  return win;
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
  guard(win);
  win.on('closed', () => { windows.main = null; });
  win.loadFile(path.join(appRoot, 'src', 'renderer', 'index.html'));
  windows.main = win;
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  // --pose-editor: the pose editor on its own (poses are still saved for the app).
  if (args.poseEditor) createEditorWindow();
  else createWindow();
  if (args.smoke) {
    setTimeout(() => {
      console.error('TIMEOUT: smoke test did not finish');
      app.exit(1);
    }, 60_000);
  }
});

app.on('window-all-closed', () => app.quit());
