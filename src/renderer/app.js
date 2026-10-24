import { AlignMode, CanvasSize, OverlayMode } from '../engine/types.js';
import { Mask } from '../engine/raster.js';
import { PracticeSession } from '../engine/session.js';
import { builtinCatalog, fromRgbaInk } from '../engine/templates.js';
import { isSolidId } from '../engine/solids.js';
import { fitRect, squareView } from '../engine/viewgeom.js';
import { BoardRenderer } from '../engine/view.js';
import { formatTrend, trendFor } from '../engine/trend.js';

const api = window.paintHikaku;
const $ = (id) => document.getElementById(id);

const PeekMs = 1800;
const CompactWidth = 1000;
const SampleId = 'image:sample_house';
const ExternalEntry = 'external';
const KindLabels = { shape: '図形', drill: '線練習', solid: '立体', image: '画像' };
const ModeNames = { onePoint: '1点', twoPoint: '2点', threePoint: '3点', isometric: 'アイソメ' };

const session = new PracticeSession({ writeRecord: (record) => api.saveRecord(record) });
const board = session.board;
const pixels = new BoardRenderer(board);
const catalog = builtinCatalog();
let records = [];
let peekTimer = 0;

const ui = {
  stage: $('stage'),
  sample: $('sample'),
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
  wipeSlider: $('wipeSlider'),
};

function setStatus(text) {
  ui.status.textContent = text;
  ui.status.title = text;
}

// ---------------------------------------------------------------- rendering

const dirty = { sample: false, paper: false };
let frameRequested = false;
let firstFrameResolve;
const firstFrame = new Promise((resolve) => { firstFrameResolve = resolve; });

function paint(canvas, rgba) {
  canvas.getContext('2d').putImageData(new ImageData(rgba, CanvasSize, CanvasSize), 0, 0);
}

function refreshBoards({ sample = true, paper = true } = {}) {
  dirty.sample ||= sample;
  dirty.paper ||= paper;
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (dirty.sample) paint(ui.sample, pixels.sample());
    if (dirty.paper) paint(ui.paper, pixels.paper());
    dirty.sample = false;
    dirty.paper = false;
    document.body.classList.toggle('result', board.resultMode);
    firstFrameResolve();
  });
}

// ---------------------------------------------------------------- templates list

function templateEntries() {
  const entries = catalog.map((t) => ({ key: t.id, label: t.labelJa, kind: t.kind }));
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
  const key = id.startsWith('image:') && id !== SampleId ? ExternalEntry : id;
  for (const b of ui.templates.querySelectorAll('button')) {
    b.setAttribute('aria-selected', String(b.dataset.key === key));
  }
  ui.perspBox.disabled = !isSolidId(id);
}

function chooseEntry(key) {
  if (key === SampleId) loadSample();
  else if (key === ExternalEntry) openImageDialog();
  else selectShape(key);
}

function afterTemplateChange() {
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
    if (file) await useImage(`image:${file.path}`, file.data, `お手本（カラー）: ${file.path}`);
  } catch (e) {
    setStatus(e.message.includes('ENOENT') ? 'ファイルがありません。' : `画像を読めませんでした: ${e.message}`);
  }
}

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
    await useImage(`image:${file.name}`, bytes, `お手本（カラー）: ${file.name}`);
  });
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

/** Canvas pixel coordinates, or null outside the visible square. */
function toCanvas(e) {
  const r = ui.paper.getBoundingClientRect();
  const sq = squareView(r.left, r.top, r.width, r.height, Infinity, 'top');
  if (sq.empty) return null;
  const x = e.clientX - sq.x;
  const y = e.clientY - sq.y;
  if (x < 0 || y < 0 || x >= sq.w || y >= sq.h) return null;
  const scale = CanvasSize / sq.w;
  return { x: x * scale, y: y * scale };
}

function setupDrawing() {
  const paper = ui.paper;
  let activePointer = null;
  paper.addEventListener('pointerdown', (e) => {
    if (board.resultMode || activePointer !== null || e.button !== 0) return;
    const p = toCanvas(e);
    if (!p) return;
    activePointer = e.pointerId;
    paper.setPointerCapture(e.pointerId);
    board.beginStroke(p.x, p.y, pressureOf(e));
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

function updateDiagLive() {
  if (board.resultMode) return;
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
  const items = records.slice().reverse().map((r) => {
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
  session.adjustPerspective({ ...session.perspective, ...change });
  if (board.resultMode) refreshDiagnosis();
  else updateDiagLive();
  refreshBoards();
  describePerspective();
}

/** Builds range + −/+ buttons; onInput gets the clamped integer value. */
function buildSlider(host, value, onInput) {
  const min = Number(host.dataset.min);
  const max = Number(host.dataset.max);
  const label = document.createElement('span');
  label.className = 'label';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = '1';
  range.setAttribute('aria-label', host.dataset.label.replace(/\{v\}.*/, '').trim());
  const show = (v) => { label.textContent = host.dataset.label.replace('{v}', String(v)); };
  const set = (v) => {
    const clamped = Math.max(min, Math.min(max, Math.round(v)));
    range.value = String(clamped);
    show(clamped);
    onInput(clamped);
  };
  const step = (text, delta, name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => set(Number(range.value) + delta));
    return b;
  };
  range.value = String(value);
  show(value);
  range.addEventListener('input', () => set(Number(range.value)));
  host.append(label, step('−', -1, '1つ減らす'), range, step('+', 1, '1つ増やす'));
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
    if (!(e.ctrlKey || e.metaKey) || e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
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
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    const px = ui.sample.getContext('2d').getImageData(384, 384, 1, 1).data;
    expect(px[3] === 255, 'Sample canvas was not painted');
    log.push('PASS GUI-SMOKE: window, sample, draw, check, save');
    api.smokeDone({ ok: true, log });
  } catch (e) {
    api.smokeDone({ ok: false, log, error: String(e?.stack ?? e) });
  }
}

// ---------------------------------------------------------------- start

async function start() {
  buildTemplateList();
  wire();
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
window.__paintHikaku = { session, board, firstFrame, records: () => records };

setupDrawing();
setupDrop();
start();
