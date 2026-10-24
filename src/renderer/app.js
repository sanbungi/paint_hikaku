import { AlignMode, CanvasSize, OverlayMode } from '../engine/types.js';
import { Mask } from '../engine/raster.js';
import { PracticeSession } from '../engine/session.js';
import { builtinCatalog, fromRgbaInk } from '../engine/templates.js';
import { isSolidId } from '../engine/solids.js';
import { fitRect } from '../engine/viewgeom.js';
import { Viewport } from '../engine/viewport.js';
import { BoardDisplay } from './boards.js';
import { BoardRenderer } from '../engine/view.js';
import { formatTrend, trendFor } from '../engine/trend.js';
import { Poses, poseById } from '../engine/poses.js';
import {
  FigureLimits, MannequinKey, defaultFigureView, figureLabel, figureTemplateId, halfFrameInRadius, parseFigureId,
} from '../engine/figure.js';

const api = window.paintHikaku;
const $ = (id) => document.getElementById(id);

const PeekMs = 1800;
const HistoryListSize = 24;
const CompactWidth = 1000;
const SampleId = 'image:sample_house';
const ExternalEntry = 'external';
const MannequinEntry = 'figure:mannequin';
const VrmEntry = 'figure:vrm';
const KindLabels = { shape: '図形', drill: '線練習', solid: '立体', figure: '人物（3D）', image: '画像' };
const ModeNames = { onePoint: '1点', twoPoint: '2点', threePoint: '3点', isometric: 'アイソメ' };

const session = new PracticeSession({ writeRecord: (record) => api.saveRecord(record) });
const board = session.board;
const pixels = new BoardRenderer(board);
const viewport = new Viewport(CanvasSize);
const catalog = builtinCatalog();
let records = [];
let peekTimer = 0;

/** 3D figure template: the model, its pose and the camera placement. */
const figure = {
  studio: null, // created on first use (WebGL)
  modelKey: MannequinKey,
  credit: '',
  active: false, // the figure is the chosen subject
  adjusting: false, // camera/pose step (live view, paper locked)
  bake: null, // last scoring render, reused for display options
  poseId: 'stand',
  tool3d: 'rotate', // left-drag on the live view: rotate | move | zoom
  view: defaultFigureView(),
  sliders: {},
};

const ui = {
  stage: $('stage'),
  sample: $('sample'),
  live: $('live'),
  paper: $('paper'),
  left: $('left'),
  right: $('right'),
  templates: $('templates'),
  history: $('history'),
  trend: $('trend'),
  diag: $('diag'),
  status: $('status'),
  peek: $('peek'),
  perspBox: $('perspBox'),
  figureBox: $('figureBox'),
  wipeSlider: $('wipeSlider'),
};

function setStatus(text) {
  ui.status.textContent = text;
  ui.status.title = text;
}

// ---------------------------------------------------------------- rendering

const dirty = { sample: false, paper: false, view: false };
let frameRequested = false;
let firstFrameResolve;
const firstFrame = new Promise((resolve) => { firstFrameResolve = resolve; });
let display = null; // BoardDisplay, created once the DOM refs exist

/** sample: re-compose the sample pixels; paper: strokes changed; view: zoom/pan/resize only. */
function refreshBoards({ sample = true, paper = true, view = false } = {}) {
  dirty.sample ||= sample;
  dirty.paper ||= paper;
  dirty.view ||= view;
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (dirty.sample) display.composeSample();
    if (dirty.sample || dirty.view) display.drawSample();
    if (dirty.paper || dirty.view) display.drawPaper();
    dirty.sample = false;
    dirty.paper = false;
    dirty.view = false;
    document.body.classList.toggle('result', board.resultMode);
    firstFrameResolve();
  });
}

const refreshView = () => refreshBoards({ sample: false, paper: false, view: true });

// ---------------------------------------------------------------- templates list

function templateEntries() {
  const entries = catalog.map((t) => ({ key: t.id, label: t.labelJa, kind: t.kind }));
  entries.push({ key: MannequinEntry, label: 'デッサン人形', kind: 'figure' });
  entries.push({ key: VrmEntry, label: 'VRM モデル…', kind: 'figure' });
  entries.push({ key: SampleId, label: 'サンプル画像', kind: 'image' });
  entries.push({ key: ExternalEntry, label: '外部画像…', kind: 'image' });
  return entries;
}

function buildTemplateList() {
  let kind = null;
  for (const entry of templateEntries()) {
    if (entry.kind !== kind) {
      kind = entry.kind;
      const head = document.createElement('div');
      head.className = 'kind';
      head.textContent = KindLabels[kind];
      ui.templates.append(head);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'option';
    b.dataset.key = entry.key;
    b.textContent = entry.label;
    b.addEventListener('click', () => chooseEntry(entry.key));
    ui.templates.append(b);
  }
}

function markSelectedTemplate() {
  const id = session.templateId;
  const fig = figure.active;
  let key = id;
  if (fig) key = figure.modelKey === MannequinKey ? MannequinEntry : VrmEntry;
  else if (id.startsWith('image:') && id !== SampleId) key = ExternalEntry;
  for (const b of ui.templates.querySelectorAll('button')) {
    b.setAttribute('aria-selected', String(b.dataset.key === key));
  }
  ui.perspBox.disabled = !isSolidId(id);
  ui.perspBox.hidden = Boolean(fig);
  ui.figureBox.hidden = !fig;
}

function chooseEntry(key) {
  if (key === SampleId) loadSample();
  else if (key === ExternalEntry) openImageDialog();
  else if (key === MannequinEntry) useMannequin();
  else if (key === VrmEntry) {
    if (figure.studio?.vrm) useLoadedVrm();
    else openVrmDialog();
  }
  else selectShape(key);
}

function afterTemplateChange() {
  if (!parseFigureId(session.templateId)) leaveFigure();
  stopPeekTimer();
  markSelectedTemplate();
  refreshBoards();
  refreshTrend();
  updateDiagLive();
}

function selectShape(id) {
  session.select(id);
  afterTemplateChange();
  describePerspective();
}

// ---------------------------------------------------------------- images

async function decodeTemplate(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const canvas = new OffscreenCanvas(CanvasSize, CanvasSize);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Transparent areas become paper, not black ink.
    ctx.fillStyle = 'rgb(250 249 245)';
    ctx.fillRect(0, 0, CanvasSize, CanvasSize);
    const r = fitRect(bitmap.width, bitmap.height, CanvasSize);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
    const color = ctx.getImageData(0, 0, CanvasSize, CanvasSize).data;
    return { color, ink: fromRgbaInk(color, CanvasSize, CanvasSize) };
  } finally {
    bitmap.close();
  }
}

/** A failed load leaves the current template and drawing untouched. */
async function useImage(id, bytes, statusText) {
  let loaded;
  try {
    loaded = await decodeTemplate(bytes);
  } catch {
    setStatus(`画像を読めませんでした: ${id.slice('image:'.length)}`);
    return false;
  }
  session.setTemplate(id, loaded.ink, new Mask(CanvasSize, CanvasSize), loaded.color);
  afterTemplateChange();
  setStatus(statusText);
  return true;
}

async function loadSample() {
  try {
    const file = await api.readSample();
    return await useImage(SampleId, file.data, 'お手本: サンプル家型（カラー表示・暗い線を採点）');
  } catch (e) {
    setStatus(`サンプル画像を読めませんでした: ${e.message}`);
    return false;
  }
}

async function openImageDialog() {
  let file;
  try {
    file = await api.openImage();
  } catch (e) {
    setStatus(`画像を読めませんでした: ${e.message}`);
    return;
  }
  if (file) await useImage(`image:${file.path}`, file.data, `お手本（カラー）: ${file.path}`);
}

async function openInitialImage() {
  try {
    const file = await api.readInitialImage();
    if (file && isVrm(file.name)) await useVrm(file.path, file.data);
    else if (file) await useImage(`image:${file.path}`, file.data, `お手本（カラー）: ${file.path}`);
  } catch (e) {
    setStatus(e.message.includes('ENOENT') ? 'ファイルがありません。' : `画像を読めませんでした: ${e.message}`);
  }
}

const isVrm = (name) => /\.vrm$/i.test(name);

function setupDrop() {
  const hint = $('dropHint');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    hint.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) hint.hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    hint.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isVrm(file.name)) await useVrm(file.name, bytes);
    else await useImage(`image:${file.name}`, bytes, `お手本（カラー）: ${file.name}`);
  });
}

// ---------------------------------------------------------------- 3D figure
//
// Two steps keep it light: while adjusting, the sample shows a live 3D view (camera, pose)
// and the paper is locked; 「この構図で描く」 renders the scoring lines once and unlocks drawing.

async function ensureStudio() {
  if (figure.studio) return figure.studio;
  const { FigureStudio } = await import('./figure/studio.js');
  figure.studio = new FigureStudio(ui.live, CanvasSize);
  figure.studio.useMannequin();
  figure.studio.onRestored = () => {
    setStatus('3D 表示を復帰しました。');
    drawLive();
  };
  return figure.studio;
}

const isAdjusting = () => figure.active && figure.adjusting;

function describeFigure() {
  const v = figure.view;
  const head = figure.adjusting
    ? `構図の調整中: ${figureLabel(figureTemplateId(figure.modelKey, figure.poseId))}`
    : `お手本: ${figureLabel(session.templateId)}`;
  setStatus(`${head}  向き${v.yawDeg}° 見下ろし${v.pitchDeg}° 画角${v.fovDeg}°${figure.credit ? `  ${figure.credit}` : ''}`);
}

let liveFrame = 0;
function drawLive() {
  if (liveFrame || !isAdjusting()) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    if (!isAdjusting()) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const side = Math.max(1, Math.round(ui.live.clientWidth * scale));
    try {
      figure.studio.renderLive(figure.poseId, figure.view, side, side);
    } catch (e) {
      setStatus(`3D 表示に失敗しました: ${e.message}`);
    }
  });
}

/** Shows or hides everything that differs between adjusting and drawing. */
function applyFigureMode() {
  const adjusting = isAdjusting();
  document.body.classList.toggle('adjusting', adjusting);
  ui.live.hidden = !adjusting;
  ui.sample.hidden = adjusting;
  $('figureCamera').hidden = !adjusting;
  $('bakeFigure').hidden = !adjusting;
  $('adjustFigure').hidden = adjusting || !figure.active;
  for (const id of ['check', 'again', 'undo', 'clear', 'save']) $(id).disabled = adjusting;
  $('drawTools').hidden = adjusting;
  $('cameraTools').hidden = !adjusting;
  // The instruction has its own box so the last diagnosis survives the adjust step.
  $('adjustHint').hidden = !adjusting;
  ui.diag.hidden = adjusting;
  if (adjusting) drawLive();
}

/** Opens the camera/pose step for the current model. Drawing stays until a new pose is baked. */
function startAdjusting() {
  figure.active = true;
  figure.adjusting = true;
  stopPeekTimer();
  markSelectedTemplate();
  applyFigureMode();
  describeFigure();
  $('figureCredit').textContent = figure.credit;
}

/** Renders the scoring lines for the chosen view. Same model and pose keep the drawing. */
async function bakeFigure() {
  let bake;
  try {
    await ensureStudio();
    bake = figure.studio.bake(figure.poseId, figure.view);
  } catch (e) {
    setStatus(`3D 表示を準備できませんでした: ${e.message}`);
    return false;
  }
  const { FigureStudio } = await import('./figure/studio.js');
  figure.bake = bake;
  const r = FigureStudio.compose(bake, figure.view);
  const id = figureTemplateId(figure.modelKey, figure.poseId);
  figure.adjusting = false;
  if (session.templateId === id) {
    // Same subject, new framing: the drawing stays.
    adjustKeepingDrawing(() => session.adjustTemplate(r.ink, r.guides, r.color));
    stopPeekTimer();
    markSelectedTemplate();
    applyFigureMode();
  } else {
    session.setTemplate(id, r.ink, r.guides, r.color);
    applyFigureMode();
    afterTemplateChange();
  }
  describeFigure();
  return true;
}

/** Display options reuse the last bake: no 3D render. */
async function recomposeFigure() {
  if (!figure.bake || !parseFigureId(session.templateId)) return;
  const { FigureStudio } = await import('./figure/studio.js');
  const r = FigureStudio.compose(figure.bake, figure.view);
  adjustKeepingDrawing(() => session.adjustTemplate(r.ink, r.guides, r.color));
}

async function useMannequin() {
  const studio = await ensureStudio().catch((e) => {
    setStatus(`3D 表示を準備できませんでした: ${e.message}`);
    return null;
  });
  if (!studio) return false;
  studio.useMannequin();
  figure.modelKey = MannequinKey;
  figure.credit = '';
  startAdjusting();
  return true;
}

/** A model that fails to load leaves the current template untouched. */
async function useVrm(name, bytes) {
  setStatus(`VRM を読み込み中: ${name}`);
  let model;
  try {
    const [{ loadVrm }] = await Promise.all([import('./figure/studio.js'), ensureStudio()]);
    model = await loadVrm(bytes);
  } catch (e) {
    setStatus(`VRM を読めませんでした: ${e.message}`);
    return false;
  }
  figure.studio.useVrm(model);
  figure.vrmKey = name;
  const authors = model.authors.filter(Boolean).join('、');
  figure.vrmCredit = model.title || authors ? `モデル: ${model.title || name}${authors ? `（${authors}）` : ''}` : '';
  return useLoadedVrm();
}

/** Back to the VRM loaded earlier (kept in memory), without asking for the file again. */
function useLoadedVrm() {
  figure.studio.useVrm(figure.studio.vrm);
  figure.modelKey = figure.vrmKey;
  figure.credit = figure.vrmCredit;
  startAdjusting();
  return true;
}

async function openVrmDialog() {
  let file;
  try {
    file = await api.openVrm();
  } catch (e) {
    setStatus(`VRM を読めませんでした: ${e.message}`);
    return;
  }
  if (file) await useVrm(file.path, file.data);
}

/** Leaves the figure step when another kind of template is chosen. */
function leaveFigure() {
  figure.active = false;
  figure.adjusting = false;
  applyFigureMode();
}

function changeCamera(change) {
  if (!isAdjusting()) return;
  Object.assign(figure.view, change);
  for (const [key, slider] of Object.entries(figure.sliders)) slider.show(figure.view[key]);
  drawLive();
  describeFigure();
}

function changeDisplay(change) {
  Object.assign(figure.view, change);
  if (isAdjusting()) drawLive();
  else recomposeFigure();
}

function setupFigureControls() {
  const pose = $('pose');
  for (const p of Poses) pose.append(new Option(p.labelJa, p.id));
  pose.addEventListener('change', () => {
    figure.poseId = poseById(pose.value).id;
    drawLive();
    describeFigure();
  });
  for (const host of $('figureCamera').querySelectorAll('.slider')) {
    const key = host.dataset.key;
    figure.sliders[key] = buildSlider(host, figure.view[key], (v) => {
      if (figure.view[key] !== v) changeCamera({ [key]: v });
    });
  }
  $('resetPan').addEventListener('click', () => changeCamera({ panX: 0, panY: 0 }));
  $('bakeFigure').addEventListener('click', bakeFigure);
  $('adjustFigure').addEventListener('click', startAdjusting);
  $('creases').addEventListener('change', (e) => changeDisplay({ creases: e.target.checked }));
  $('floorGuide').addEventListener('change', (e) => changeDisplay({ floorGuide: e.target.checked }));
  $('figureDisplay').addEventListener('change', (e) => changeDisplay({ display: e.target.value }));
  figure.lineSlider = buildSlider($('figureLineWidth'), figure.view.lineWidth, (v) => {
    if (figure.view.lineWidth !== v) changeDisplay({ lineWidth: v });
  });
  $('openVrm').addEventListener('click', openVrmDialog);
  new ResizeObserver(drawLive).observe(ui.live);

  // On the live view the left button uses the chosen 3D tool (rotate / move / zoom);
  // the right button always moves and the wheel always zooms, so a mouse needs no buttons.
  const clamp = (key, v) => Math.max(FigureLimits[key][0], Math.min(FigureLimits[key][1], v));
  const zoomBy = (factor) => changeCamera({ zoomPct: Math.round(clamp('zoomPct', figure.view.zoomPct * factor)) });
  let drag = null;
  ui.live.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.live.addEventListener('pointerdown', (e) => {
    if (!isAdjusting() || drag || (e.button !== 0 && e.button !== 2)) return;
    const mode = e.button === 2 ? 'move' : figure.tool3d;
    drag = { id: e.pointerId, mode, x: e.clientX, y: e.clientY, view: { ...figure.view } };
    ui.live.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  ui.live.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const v0 = drag.view;
    if (drag.mode === 'move') {
      // Grab-and-move: the figure follows the pointer at any zoom.
      const perPixel = halfFrameInRadius(v0.fovDeg, v0.zoomPct) / (ui.live.clientWidth / 2 || 1);
      changeCamera({ panX: clamp('panX', v0.panX - dx * perPixel), panY: clamp('panY', v0.panY + dy * perPixel) });
    } else if (drag.mode === 'zoom') {
      // Drag up to zoom in, down to zoom out (doubling every 120 px).
      changeCamera({ zoomPct: Math.round(clamp('zoomPct', v0.zoomPct * 2 ** (-dy / 120))) });
    } else {
      const yawDeg = v0.yawDeg - dx * 0.5;
      const wrapped = ((((yawDeg + 180) % 360) + 360) % 360) - 180;
      changeCamera({ yawDeg: Math.round(wrapped), pitchDeg: Math.round(clamp('pitchDeg', v0.pitchDeg + dy * 0.3)) });
    }
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  ui.live.addEventListener('pointerup', end);
  ui.live.addEventListener('pointercancel', end);
  ui.live.addEventListener('wheel', (e) => {
    if (!isAdjusting()) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  for (const [id, tool] of [['tool3dRotate', 'rotate'], ['tool3dMove', 'move'], ['tool3dZoom', 'zoom']]) {
    $(id).addEventListener('click', () => setTool3d(tool));
  }
  $('zoom3dIn').addEventListener('click', () => zoomBy(1.25));
  $('zoom3dOut').addEventListener('click', () => zoomBy(1 / 1.25));
  setTool3d('rotate');
}

function setTool3d(tool) {
  figure.tool3d = tool;
  for (const [id, t] of [['tool3dRotate', 'rotate'], ['tool3dMove', 'move'], ['tool3dZoom', 'zoom']]) {
    $(id).setAttribute('aria-pressed', String(t === tool));
  }
  ui.live.dataset.tool = tool;
}

// ---------------------------------------------------------------- drawing

function pressureOf(e) {
  if (!board.usePressure) return 1;
  // Pens report 0..1; map so a medium press draws the default width.
  if (e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5)) {
    return 0.2 + 1.35 * e.pressure;
  }
  if (e.shiftKey) return 0.4;
  if (e.ctrlKey) return 1.55;
  return 1;
}

/** Pointer position relative to a board square, in display (CSS) pixels. */
function boardPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, side: r.width };
}

/** Canvas (768²) coordinates under the pointer, or null off the paper. */
function toCanvas(e) {
  const b = boardPoint(ui.paper, e);
  if (!(b.side > 0)) return null;
  const p = viewport.toCanvas(b.x, b.y, b.side);
  if (p.x < 0 || p.y < 0 || p.x >= CanvasSize || p.y >= CanvasSize) return null;
  return p;
}

// ---------------------------------------------------------------- tools and view

const tools = { current: 'pen', spaceHeld: false };
const ZoomStep = 1.25;

function setTool(tool) {
  tools.current = tool;
  if (tool === 'pen' || tool === 'eraser') board.tool = tool;
  for (const [id, t] of [['toolPen', 'pen'], ['toolEraser', 'eraser'], ['toolHand', 'hand']]) {
    $(id).setAttribute('aria-pressed', String(t === tool));
  }
  document.body.dataset.tool = tool;
  showWidth();
}

function showWidth() {
  const eraser = tools.current === 'eraser';
  const width = eraser ? board.eraserWidth : board.penWidth;
  $('penWidth').max = eraser ? '80' : '30';
  $('penWidth').value = String(width);
  $('penWidthOut').textContent = `${width}px`;
  $('penWidthName').textContent = eraser ? '消しゴム' : '太さ';
}

function setPenColor(color) {
  board.penColor = color;
  $('penColor').value = color;
  for (const b of document.querySelectorAll('.swatch')) b.setAttribute('aria-pressed', String(b.dataset.color === color));
}

function showZoom() {
  $('zoomLevel').textContent = `${Math.round(viewport.zoom * 100)}%`;
}

/** Zooms both boards around a point of the given board (default: its centre). */
function zoomBoards(factor, canvas = ui.paper, e = null) {
  const r = canvas.getBoundingClientRect();
  const at = e ? boardPoint(canvas, e) : { x: r.width / 2, y: r.width / 2, side: r.width };
  viewport.zoomAt(factor, at.x, at.y, at.side);
  showZoom();
  refreshView();
}

function fitBoards() {
  viewport.reset();
  showZoom();
  refreshView();
}

/** Hand dragging (hand tool, Space, or the middle button) and wheel zoom on either board. */
function setupViewControls() {
  for (const canvas of [ui.sample, ui.paper]) {
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const hand = tools.current === 'hand' || tools.spaceHeld || e.button === 1;
      if (!hand || drag || isAdjusting() || (e.button !== 0 && e.button !== 1)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      viewport.panBy(e.clientX - drag.x, e.clientY - drag.y, canvas.getBoundingClientRect().width);
      drag.x = e.clientX;
      drag.y = e.clientY;
      refreshView();
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBoards(e.deltaY < 0 ? 1.15 : 1 / 1.15, canvas, e);
    }, { passive: false });
    new ResizeObserver(refreshView).observe(canvas);
    // Middle-button drags pan; keep Chromium's autoscroll from starting.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }
  watchPixelRatio(() => {
    refreshView();
    drawLive();
  });
}

/**
 * Moving the window to a monitor with another scale changes devicePixelRatio, not the CSS
 * size, so no resize is observed. A cheap check twice a second catches every such move.
 */
function watchPixelRatio(onChange) {
  let ratio = window.devicePixelRatio;
  setInterval(() => {
    if (window.devicePixelRatio === ratio) return;
    ratio = window.devicePixelRatio;
    onChange();
  }, 500);
}

function setupTools() {
  $('toolPen').addEventListener('click', () => setTool('pen'));
  $('toolEraser').addEventListener('click', () => setTool('eraser'));
  $('toolHand').addEventListener('click', () => setTool('hand'));
  $('penWidth').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (tools.current === 'eraser') board.eraserWidth = v;
    else board.penWidth = v;
    showWidth();
  });
  for (const b of document.querySelectorAll('.swatch')) b.addEventListener('click', () => setPenColor(b.dataset.color));
  $('penColor').addEventListener('input', (e) => setPenColor(e.target.value));
  $('zoomIn').addEventListener('click', () => zoomBoards(ZoomStep));
  $('zoomOut').addEventListener('click', () => zoomBoards(1 / ZoomStep));
  $('zoomFit').addEventListener('click', fitBoards);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Space' && !e.repeat) {
      tools.spaceHeld = true;
      document.body.classList.add('space-hand');
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '0') fitBoards();
      else if (e.key === '+' || e.key === '=' || e.key === ';') zoomBoards(ZoomStep);
      else if (e.key === '-') zoomBoards(1 / ZoomStep);
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'p') setTool('pen');
    else if (key === 'e') setTool('eraser');
    else if (key === 'h') setTool('hand');
  });
  const releaseSpace = () => {
    tools.spaceHeld = false;
    document.body.classList.remove('space-hand');
  };
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') releaseSpace();
  });
  // Alt+Tab with Space held never delivers the keyup; do not leave the pen stuck as a hand.
  window.addEventListener('blur', releaseSpace);
  document.addEventListener('visibilitychange', releaseSpace);
  setTool('pen');
  setPenColor(board.penColor);
  showZoom();
}

function setupDrawing() {
  const paper = ui.paper;
  let activePointer = null;
  paper.addEventListener('pointerdown', (e) => {
    if (isAdjusting() || tools.current === 'hand' || tools.spaceHeld) return;
    // Button 5 is the eraser end of a pen (Wacom and Windows Ink): it erases whatever tool is chosen.
    const eraserTip = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (activePointer !== null || (e.button !== 0 && !eraserTip)) return;
    const p = toCanvas(e);
    if (!p) return;
    // Drawing on a checked result reopens it: the lines stay, the next check re-scores.
    if (session.reopen()) {
      markDiagnosisStale();
      refreshBoards({ paper: false });
    }
    activePointer = e.pointerId;
    try {
      paper.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (e.g. synthetic events); drawing still works inside the paper.
    }
    const chosen = board.tool;
    if (eraserTip) board.tool = 'eraser';
    board.beginStroke(p.x, p.y, pressureOf(e));
    board.tool = chosen;
    refreshBoards({ sample: false });
    e.preventDefault();
  });
  paper.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !board.drawing) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) {
      const p = toCanvas(ev);
      if (p) board.addPoint(p.x, p.y, pressureOf(ev));
    }
    refreshBoards({ sample: false });
  });
  const finish = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (!board.drawing) return;
    board.endStroke();
    session.saved = false;
    refreshBoards({ sample: false });
    updateDiagLive();
  };
  paper.addEventListener('pointerup', finish);
  paper.addEventListener('pointercancel', finish);
  paper.addEventListener('lostpointercapture', finish);
}

// ---------------------------------------------------------------- commands

/** Keeps the last diagnosis readable while the drawing is being corrected. */
function markDiagnosisStale() {
  if (ui.diag.classList.contains('stale') || !ui.diag.querySelector('.metrics')) return;
  ui.diag.classList.add('stale');
  const note = document.createElement('p');
  note.className = 'stale-note';
  note.textContent = '加筆中 — もう一度「答え合わせ」で採点し直します（下は前回の結果）。';
  ui.diag.prepend(note);
  setStatus('加筆中 — 「答え合わせ」で採点し直します');
}

function updateDiagLive() {
  if (board.resultMode) return;
  if (ui.diag.classList.contains('stale') && board.strokes.length) return;
  ui.diag.classList.remove('stale');
  ui.diag.textContent = board.memoryMode
    ? '記憶模写: 見本は隠しています。「チラ見」で数秒だけ出せます。描いて答え合わせ。'
    : '題材を選び、白い紙に描き、「答え合わせ」で採点します。';
}

function refreshDiagnosis() {
  const { metrics: m, commentsJa } = session.diagnose();
  const pct = (v) => (v * 100).toFixed(0);
  const head = document.createElement('div');
  head.className = 'metrics';
  head.textContent = `参考 IoU ${m.iou.toFixed(2)}\n`
    + `はみ出し ${pct(m.extraRate)}%  未到達 ${pct(m.missRate)}%\n`
    + `距離（自分→お手本） ${m.chamferUserToTpl.toFixed(1)} px\n`
    + `大きさ比 ${m.scaleRatio.toFixed(2)}  ずれ (${m.dx.toFixed(0)}, ${m.dy.toFixed(0)})`;
  ui.diag.classList.remove('stale');
  ui.diag.replaceChildren(head, ...commentsJa.map((c) => {
    const p = document.createElement('p');
    p.textContent = c;
    return p;
  }));
  setStatus(session.saved ? '記録済み' : '未記録 — 「記録」で履歴に残します');
}

function doCheck() {
  session.check();
  stopPeekTimer();
  refreshDiagnosis();
  refreshBoards();
}

function redo() {
  session.clear();
  refreshBoards();
  updateDiagLive();
}

function doUndo() {
  if (board.resultMode) markDiagnosisStale();
  session.undo();
  refreshBoards();
  updateDiagLive();
}

async function persist() {
  if (!board.resultMode) {
    setStatus('先に答え合わせしてください。');
    return;
  }
  if (session.saved) {
    setStatus('この結果は記録済みです。');
    return;
  }
  try {
    if (!(await session.save())) return;
  } catch (e) {
    setStatus(`記録できませんでした: ${e.message}`);
    return;
  }
  await reloadHistory();
  setStatus('記録しました。');
}

async function reloadHistory() {
  try {
    records = await api.loadHistory();
  } catch (e) {
    records = [];
    setStatus(`履歴を読めませんでした: ${e.message}`);
  }
  const items = records.slice(-HistoryListSize).reverse().map((r) => {
    const li = document.createElement('li');
    li.textContent = `${r.isoTime}  ${shortId(r.templateId)}  IoU ${r.metrics.iou.toFixed(2)}`;
    li.title = r.templateId;
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '（まだ記録がありません）';
    items.push(li);
  }
  ui.history.replaceChildren(...items);
  refreshTrend();
}

function shortId(id) {
  if (parseFigureId(id)) return figureLabel(id);
  if (!id.startsWith('image:')) return catalog.find((t) => t.id === id)?.labelJa ?? id;
  return id === SampleId ? 'サンプル画像' : id.split(/[\\/]/).pop();
}

function refreshTrend() {
  ui.trend.textContent = formatTrend(trendFor(records, session.templateId), shortId(session.templateId));
}

function stopPeekTimer() {
  clearTimeout(peekTimer);
  peekTimer = 0;
}

function peek() {
  stopPeekTimer();
  const generation = session.peek();
  refreshBoards({ paper: false });
  peekTimer = setTimeout(() => {
    session.expirePeek(generation);
    peekTimer = 0;
    refreshBoards({ paper: false });
  }, PeekMs);
}

// ---------------------------------------------------------------- perspective

function describePerspective() {
  const p = session.perspective;
  if (isSolidId(session.templateId)) {
    setStatus(`お手本: ${shortId(session.templateId)}  パース:${ModeNames[p.mode]}  水平${p.yawDeg}° 地平線${p.horizonPct}%`);
  } else if (!session.templateId.startsWith('image:')) {
    setStatus(`お手本: ${shortId(session.templateId)}（平面。パースは立体サンプル用）`);
  }
}

function applyPerspective(change) {
  adjustKeepingDrawing(() => session.adjustPerspective({ ...session.perspective, ...change }));
  describePerspective();
}

/**
 * Runs a template change that keeps the drawing. A result that survives is re-scored;
 * one that the change invalidated stays readable as 加筆中 until the next check.
 */
function adjustKeepingDrawing(change) {
  const hadResult = board.resultMode;
  change();
  if (board.resultMode) refreshDiagnosis();
  else if (hadResult) {
    ui.diag.classList.remove('stale');
    markDiagnosisStale();
  } else updateDiagLive();
  refreshBoards();
}

/** Builds range + −/+ buttons; onInput gets the clamped integer value. */
function buildSlider(host, value, onInput) {
  const min = Number(host.dataset.min);
  const max = Number(host.dataset.max);
  const stepSize = Number(host.dataset.step ?? 1);
  const label = document.createElement('span');
  label.className = 'label';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(stepSize);
  range.setAttribute('aria-label', host.dataset.label.replace(/\{v\}.*/, '').trim());
  const show = (v) => { label.textContent = host.dataset.label.replace('{v}', String(v)); };
  const set = (v) => {
    const snapped = Math.round(v / stepSize) * stepSize;
    const clamped = Math.max(min, Math.min(max, Number(snapped.toFixed(3))));
    range.value = String(clamped);
    show(clamped);
    onInput(clamped);
  };
  const step = (text, delta, name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => set(Number(range.value) + delta * stepSize));
    return b;
  };
  range.value = String(value);
  show(value);
  range.addEventListener('input', () => set(Number(range.value)));
  host.append(label, step('−', -1, '1つ減らす'), range, step('+', 1, '1つ増やす'));
  return {
    show: (v) => {
      range.value = String(v);
      show(v);
    },
  };
}

// ---------------------------------------------------------------- layout

const panels = { leftExplicit: false, rightExplicit: false, compact: false };

function applyPanels() {
  const compact = window.innerWidth < CompactWidth;
  panels.compact = compact;
  if (!panels.leftExplicit) ui.left.hidden = compact;
  if (!panels.rightExplicit) ui.right.hidden = compact;
  if (compact && !ui.left.hidden && !ui.right.hidden) ui.right.hidden = true;
  $('toggleLeft').setAttribute('aria-pressed', String(!ui.left.hidden));
  $('toggleRight').setAttribute('aria-pressed', String(!ui.right.hidden));
}

function togglePanel(which) {
  const [panel, other] = which === 'left' ? [ui.left, ui.right] : [ui.right, ui.left];
  panels[`${which}Explicit`] = true;
  panel.hidden = !panel.hidden;
  if (panels.compact && !panel.hidden) {
    panels[`${which === 'left' ? 'right' : 'left'}Explicit`] = true;
    other.hidden = true;
  }
  applyPanels();
}

function setLayout(direction) {
  ui.stage.classList.toggle('row', direction === 'row');
  ui.stage.classList.toggle('column', direction === 'column');
}

// ---------------------------------------------------------------- wiring

function wire() {
  $('toggleLeft').addEventListener('click', () => togglePanel('left'));
  $('toggleRight').addEventListener('click', () => togglePanel('right'));
  $('layout').addEventListener('change', (e) => setLayout(e.target.value));
  $('grid').addEventListener('change', (e) => {
    board.gridN = Number(e.target.value);
    refreshBoards();
  });
  $('bbox').addEventListener('change', (e) => {
    board.showBBox = e.target.checked;
    refreshBoards();
  });
  $('memory').addEventListener('change', (e) => {
    stopPeekTimer();
    session.memory(e.target.checked);
    ui.peek.disabled = !e.target.checked;
    refreshBoards({ paper: false });
    updateDiagLive();
  });
  ui.peek.addEventListener('click', peek);
  $('pressure').addEventListener('change', (e) => { board.usePressure = e.target.checked; });
  $('openImage').addEventListener('click', openImageDialog);
  $('sampleImage').addEventListener('click', loadSample);

  $('check').addEventListener('click', doCheck);
  $('again').addEventListener('click', redo);
  $('undo').addEventListener('click', doUndo);
  $('clear').addEventListener('click', redo);
  $('save').addEventListener('click', persist);

  $('perspMode').addEventListener('change', (e) => applyPerspective({ mode: e.target.value }));
  for (const host of ui.perspBox.querySelectorAll('.slider')) {
    const key = host.dataset.key;
    buildSlider(host, session.perspective[key], (v) => {
      if (session.perspective[key] !== v) applyPerspective({ [key]: v });
    });
  }
  $('showGuides').addEventListener('change', (e) => applyPerspective({ showGuides: e.target.checked }));
  $('showHidden').addEventListener('change', (e) => applyPerspective({ showHidden: e.target.checked }));

  $('overlay').addEventListener('change', (e) => {
    board.overlay = OverlayMode[e.target.value];
    ui.wipeSlider.hidden = board.overlay !== OverlayMode.wipe;
    refreshBoards({ paper: false });
  });
  buildSlider(ui.wipeSlider, board.wipePct, (v) => {
    board.wipePct = v;
    refreshBoards({ paper: false });
  });
  ui.wipeSlider.hidden = true;
  $('align').addEventListener('change', (e) => {
    session.setAlignment(e.target.checked ? AlignMode.centroid : AlignMode.none);
    if (board.resultMode) refreshDiagnosis();
    refreshBoards();
  });

  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target instanceof HTMLInputElement || isAdjusting()) return;
    const key = e.key.toLowerCase();
    if (board.drawing) return; // never undo under the pen
    if (key === 'z') doUndo();
    else if (key === 'enter') doCheck();
    else if (key === 's') persist();
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', applyPanels);
}

// ---------------------------------------------------------------- smoke test

async function smokeTest() {
  const log = [];
  const expect = (ok, what) => {
    if (!ok) throw new Error(what);
  };
  try {
    await firstFrame;
    expect(await loadSample(), 'Embedded sample did not load');
    expect(board.tplColor?.length === CanvasSize * CanvasSize * 4, 'Sample has no colour pixels');
    selectShape('circle');
    board.beginStroke(200, 384, 1);
    for (let x = 210; x <= 560; x += 10) board.addPoint(x, 384, 1);
    board.endStroke();
    doCheck();
    expect(board.resultMode, 'Check did not enter result mode');
    await persist();
    expect(session.saved && records.length === 1, 'Record was not saved to the isolated data dir');
    figure.poseId = 'walk';
    expect(await useMannequin(), '3D view did not start');
    await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
    expect(await bakeFigure(), '3D figure did not render');
    const figureInk = board.tpl.px.reduce((n, p) => n + (p ? 1 : 0), 0);
    expect(figureInk > 3000, `3D figure has too few lines (${figureInk})`);
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    const px = display.pixelAt('sample', 384, 384);
    expect(px[3] === 255, 'Sample canvas was not painted');
    log.push('PASS GUI-SMOKE: window, sample, draw, check, save, 3D figure');
    api.smokeDone({ ok: true, log });
  } catch (e) {
    api.smokeDone({ ok: false, log, error: String(e?.stack ?? e) });
  }
}

// ---------------------------------------------------------------- start

async function start() {
  buildTemplateList();
  wire();
  setupTools();
  setupFigureControls();
  applyPanels();
  setLayout('row');
  selectShape('circle');
  setStatus('位置合わせなし。点数は参考です。クセを直す練習です。');
  await reloadHistory();
  const args = await api.args();
  if (args.smoke) await smokeTest();
  else if (args.imagePath) await openInitialImage();
}

// Read-only handle for automated GUI tests.
window.__paintHikaku = {
  session, board, firstFrame, figure, viewport, records: () => records,
  pixel: (role, x, y) => display.pixelAt(role, x, y),
};

display = new BoardDisplay({ sample: ui.sample, paper: ui.paper, board, pixels, viewport });
setupViewControls();
setupDrawing();
setupDrop();
start();
