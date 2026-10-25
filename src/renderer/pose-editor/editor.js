import { createMannequin } from '../figure/mannequin.js';
import { applyRigPose, rigOfModel } from '../figure/rig.js';
import { Handles, PinnableHandles, PoseRig, handleById } from '../../engine/posing.js';
import { Poses, UserPosePrefix, poseById } from '../../engine/poses.js';
import { fitLandmarks } from '../../engine/posefit.js';
import { PoseView } from './view3d.js';
import { PoseConnections, createDetector, detectPose } from './detect.js';

/**
 * Pose editor window: full-body IK posing on the model the main window uses, saving user
 * poses, and image → pose with MediaPipe. It talks to the app only through window.poseEditorApi
 * (pose-preload.cjs), so it also runs on its own (`--pose-editor`).
 */
const api = window.poseEditorApi;
const $ = (id) => document.getElementById(id);

const BoneLabels = {
  hips: '腰', spine: '背骨', chest: '胸', upperChest: '胸の上', neck: '首', head: '頭',
  leftShoulder: '左肩', leftUpperArm: '左上腕', leftLowerArm: '左前腕', leftHand: '左手',
  rightShoulder: '右肩', rightUpperArm: '右上腕', rightLowerArm: '右前腕', rightHand: '右手',
  leftUpperLeg: '左太もも', leftLowerLeg: '左すね', leftFoot: '左足', leftToes: '左つま先',
  rightUpperLeg: '右太もも', rightLowerLeg: '右すね', rightFoot: '右足', rightToes: '右つま先',
};

/** Bone shown in the angle sliders when a handle is selected. */
const HandleBone = {
  head: 'head', look: 'head', chest: 'chest', hips: 'hips',
  leftHand: 'leftHand', rightHand: 'rightHand', leftFoot: 'leftFoot', rightFoot: 'rightFoot',
  leftElbow: 'leftLowerArm', rightElbow: 'rightLowerArm', leftKnee: 'leftLowerLeg', rightKnee: 'rightLowerLeg',
};

const state = {
  model: null,
  modelName: 'デッサン人形',
  mannequin: null,
  rig: null, // { skel, root, nodes, hipsRest, floorY }
  poser: null, // PoseRig
  selected: null,
  hover: null,
  userPoses: [],
  currentId: null, // the saved user pose being edited, if any
  modified: false,
  image: null, // { bitmap, name, landmarks (image), world }
  modelBytes: null, // MediaPipe model
  sliderUndo: false,
};

const view = new PoseView($('view'));

function setStatus(text) {
  $('status').textContent = text;
  $('status').title = text;
}

// ---------------------------------------------------------------- model

function useModel(model, name) {
  const previous = state.poser ? { bones: state.poser.toPoseData().bones } : null;
  const old = state.poser;
  state.model = model;
  state.modelName = name;
  state.rig = rigOfModel(model);
  state.poser = new PoseRig(state.rig.skel, { floorY: state.rig.floorY });
  if (old) {
    Object.assign(state.poser.pins, old.pins);
    state.poser.autoGround = old.autoGround;
    state.poser.reachAssist = old.reachAssist;
  }
  if (previous) state.poser.load(previous);
  state.poser.undoStack = [];
  view.setModel(model, state.rig.root);
  view.setFloor(view.rigToWorld([0, state.rig.floorY, 0]).y);
  $('modelName').textContent = name;
  buildBoneList();
  update();
  view.frameModel();
}

function useMannequin() {
  state.mannequin ??= createMannequin();
  useModel(state.mannequin, 'デッサン人形');
}

async function useVrmBytes(bytes, name, credit = '') {
  setStatus(`VRM を読み込み中: ${name}`);
  try {
    const { loadVrm } = await import('../figure/studio.js');
    const model = await loadVrm(bytes);
    const authors = model.authors.filter(Boolean).join('、');
    const label = credit || `${model.title || name}${authors ? `（${authors}）` : ''}`;
    if (state.model && state.model !== state.mannequin) state.model.dispose();
    useModel(model, label);
    setStatus(`モデル: ${label}`);
    return true;
  } catch (e) {
    setStatus(`VRM を読めませんでした: ${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------- redraw

function skeletonLines(f) {
  const lines = [];
  const skel = state.rig.skel;
  for (const n of skel.names) {
    const p = skel.parentOf(n);
    if (p) lines.push(f.pos[p], f.pos[n]);
  }
  return lines;
}

function update() {
  const poser = state.poser;
  applyRigPose(state.rig, state.model, poser.pose);
  const f = poser.fk();
  view.setHandles(poser.handlePositions(f), { selected: state.selected, hover: state.hover, pins: poser.pins });
  view.setSkeleton(skeletonLines(f));
  $('undo').disabled = !poser.undoStack.length;
  $('redo').disabled = !poser.redoStack.length;
  showAngles();
}

function changed() {
  state.modified = true;
  update();
  showTitle();
}

function showTitle() {
  const name = $('poseName').value.trim() || '無題のポーズ';
  document.title = `${state.modified ? '● ' : ''}${name} - ポーズエディタ`;
}

// ---------------------------------------------------------------- selection and angles

function buildBoneList() {
  const sel = $('bone');
  sel.textContent = '';
  for (const n of state.rig.skel.names) sel.append(new Option(BoneLabels[n] ?? n, n));
  sel.value = 'hips';
}

function select(id) {
  state.selected = id;
  const h = id ? handleById(id) : null;
  $('selName').textContent = h ? h.labelJa : 'なし（点をクリック）';
  const pinnable = !!id && PinnableHandles.includes(id);
  $('pin').disabled = !pinnable;
  $('pin').checked = pinnable && state.poser.pins[id];
  const bone = id && HandleBone[id];
  if (bone && state.rig.skel.rest[bone]) $('bone').value = bone;
  update();
}

function showAngles() {
  const bone = $('bone').value;
  if (!bone || !state.poser) return;
  const e = state.poser.boneEuler(bone);
  for (const input of $('angles').querySelectorAll('input')) {
    const v = Math.round(e[Number(input.dataset.axis)]);
    if (document.activeElement !== input) input.value = String(v);
    input.nextElementSibling.textContent = `${v}°`;
  }
}

function togglePin(id = state.selected) {
  if (!id || !PinnableHandles.includes(id)) return;
  state.poser.pins[id] = !state.poser.pins[id];
  if (id === state.selected) $('pin').checked = state.poser.pins[id];
  setStatus(`${handleById(id).labelJa}: ${state.poser.pins[id] ? 'ピン留めしました（ほかを動かしても残ります）' : 'ピンを外しました'}`);
  update();
}

// ---------------------------------------------------------------- pointer

function setupPointer() {
  const canvas = $('view');
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (drag) return;
    canvas.focus();
    const id = e.button === 0 ? view.pick(e.clientX, e.clientY) : null;
    if (id) {
      select(id);
      const mode = e.shiftKey ? 'rotate' : 'move';
      drag = { id: e.pointerId, mode, handle: id, x: e.clientX, y: e.clientY, through: view.handles.get(id).pos.clone() };
      state.poser.beginDrag(id);
      setStatus(mode === 'rotate' ? `${handleById(id).labelJa}を回しています` : `${handleById(id).labelJa}を動かしています`);
    } else {
      drag = { id: e.pointerId, mode: e.button === 0 && !e.shiftKey ? 'orbit' : 'pan', x: e.clientX, y: e.clientY };
    }
    canvas.dataset.drag = drag.mode;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const id = view.pick(e.clientX, e.clientY);
      if (id !== state.hover) {
        state.hover = id;
        canvas.dataset.hover = id ? 'handle' : '';
        canvas.title = id ? `${handleById(id).labelJa}（ドラッグで動かす / Shift で回す${PinnableHandles.includes(id) ? ' / ダブルクリックでピン留め' : ''}）` : '';
        update();
      }
      return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.mode === 'move') {
      const p = view.pointOnPlane(e.clientX, e.clientY, drag.through);
      if (p) state.poser.dragTo(view.worldToRig(p));
      update();
    } else if (drag.mode === 'rotate') {
      state.poser.rotateBy(view.worldRotToRig(view.dragRotation(dx, dy)));
      update();
    } else {
      const mx = e.clientX - (drag.lx ?? drag.x);
      const my = e.clientY - (drag.ly ?? drag.y);
      if (drag.mode === 'orbit') view.orbitBy(mx, my);
      else view.panBy(mx, my);
      drag.lx = e.clientX;
      drag.ly = e.clientY;
      update();
    }
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.mode === 'move' || drag.mode === 'rotate') {
      state.poser.endDrag();
      changed();
      setStatus(`${handleById(drag.handle).labelJa}を動かしました。Ctrl+Z で戻せます。`);
    }
    drag = null;
    delete canvas.dataset.drag;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', (e) => {
    const id = view.pick(e.clientX, e.clientY);
    if (id) togglePin(id);
    else view.frameModel();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  canvas.tabIndex = 0;
}

// ---------------------------------------------------------------- poses

const newId = () => `${UserPosePrefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function currentPoseData(id = state.currentId) {
  return { id, labelJa: $('poseName').value.trim() || '無題のポーズ', ...state.poser.toPoseData() };
}

function renderUserPoses() {
  const sel = $('userPoses');
  sel.textContent = '';
  for (const p of state.userPoses) sel.append(new Option(p.labelJa, p.id));
  sel.value = state.currentId ?? '';
  $('deletePose').disabled = !state.currentId;
}

async function storePoses(list) {
  try {
    state.userPoses = await api.savePoses(list);
    renderUserPoses();
    return true;
  } catch (e) {
    setStatus(`保存できませんでした: ${e.message}`);
    return false;
  }
}

async function save() {
  if (!state.currentId || !state.userPoses.some((p) => p.id === state.currentId)) return saveAs();
  const data = currentPoseData();
  if (!(await storePoses(state.userPoses.map((p) => (p.id === data.id ? data : p))))) return null;
  state.modified = false;
  showTitle();
  setStatus(`「${data.labelJa}」を上書き保存しました。`);
  return data;
}

async function saveAs() {
  if (!$('poseName').value.trim()) $('poseName').value = `ポーズ ${state.userPoses.length + 1}`;
  const data = currentPoseData(newId());
  if (!(await storePoses([...state.userPoses, data]))) return null;
  state.currentId = data.id;
  state.modified = false;
  renderUserPoses();
  showTitle();
  setStatus(`「${data.labelJa}」を保存しました。メイン画面のポーズ一覧にも出ます。`);
  return data;
}

function loadPose(p, { asUserPose = false } = {}) {
  state.poser.load(p);
  state.currentId = asUserPose ? p.id : null;
  $('poseName').value = asUserPose ? p.labelJa : '';
  state.modified = !asUserPose;
  renderUserPoses();
  update();
  showTitle();
}

async function useInMain() {
  const data = state.modified || !state.currentId ? await save() : currentPoseData();
  if (!data) return;
  let sent;
  try {
    sent = await api.sendToMain(data);
  } catch (e) {
    setStatus(`メイン画面に送れませんでした: ${e.message}`);
    return;
  }
  setStatus(sent
    ? `「${data.labelJa}」をメイン画面に送りました。構図を決めて「この構図で描く」を押してください。`
    : `「${data.labelJa}」を保存しました（メイン画面は開いていません）。`);
}

function setupPoseList() {
  const builtin = $('builtinPoses');
  builtin.append(new Option('選ぶ…', ''));
  for (const p of Poses) builtin.append(new Option(p.labelJa, p.id));
  builtin.addEventListener('change', () => {
    if (!builtin.value) return;
    const p = poseById(builtin.value);
    loadPose(p);
    builtin.value = '';
    setStatus(`サンプル「${p.labelJa}」を読み込みました。名前を付けて保存すると自作ポーズになります。`);
  });
  $('userPoses').addEventListener('change', (e) => {
    const p = state.userPoses.find((q) => q.id === e.target.value);
    if (p) loadPose(p, { asUserPose: true });
  });
  $('save').addEventListener('click', save);
  $('saveAs').addEventListener('click', () => {
    if (state.currentId) $('poseName').value = `${$('poseName').value.trim() || '無題のポーズ'} のコピー`;
    saveAs();
  });
  $('poseName').addEventListener('input', () => {
    state.modified = true;
    showTitle();
  });
  $('deletePose').addEventListener('click', async () => {
    const p = state.userPoses.find((q) => q.id === state.currentId);
    if (!p || !window.confirm(`「${p.labelJa}」を削除しますか？`)) return;
    state.currentId = null;
    if (await storePoses(state.userPoses.filter((q) => q.id !== p.id))) setStatus(`「${p.labelJa}」を削除しました。`);
  });
  $('exportPose').addEventListener('click', async () => {
    try {
      const file = await api.exportPose(currentPoseData());
      if (file) setStatus(`書き出しました: ${file}`);
    } catch (e) {
      setStatus(`書き出せませんでした: ${e.message}`);
    }
  });
  $('importPose').addEventListener('click', async () => {
    try {
      const p = await api.importPose();
      if (!p) return;
      loadPose(p);
      $('poseName').value = p.labelJa;
      state.modified = true;
      showTitle();
      setStatus(`「${p.labelJa}」を読み込みました。保存すると自作ポーズに加わります。`);
    } catch (e) {
      setStatus(`読み込めませんでした: ${e.message}`);
    }
  });
  $('useInMain').addEventListener('click', useInMain);
}

// ---------------------------------------------------------------- image → pose

function drawReference() {
  const img = state.image;
  $('refPanel').hidden = !img;
  if (!img) return;
  const c = $('refCanvas');
  const scale = Math.min(1, 600 / Math.max(img.bitmap.width, img.bitmap.height));
  c.width = Math.round(img.bitmap.width * scale);
  c.height = Math.round(img.bitmap.height * scale);
  const g = c.getContext('2d');
  g.drawImage(img.bitmap, 0, 0, c.width, c.height);
  $('refName').textContent = img.name;
  if (!img.landmarks) return;
  const pt = (i) => [img.landmarks[i].x * c.width, img.landmarks[i].y * c.height];
  g.lineWidth = Math.max(2, c.width / 150);
  g.strokeStyle = 'rgba(50, 90, 210, 0.9)';
  for (const [a, b] of PoseConnections) {
    g.beginPath();
    g.moveTo(...pt(a));
    g.lineTo(...pt(b));
    g.stroke();
  }
  for (const [i, p] of img.landmarks.entries()) {
    if (i > 0 && i < 11 && i !== 7 && i !== 8) continue;
    g.fillStyle = i % 2 ? 'rgb(58, 123, 213)' : 'rgb(224, 120, 42)';
    g.beginPath();
    g.arc(...pt(i), g.lineWidth * 1.3, 0, Math.PI * 2);
    g.fill();
  }
}

/** World landmarks → pose on the current model (also the test entry point). */
function applyLandmarks(world, { mirror = $('mirrorImage').checked } = {}) {
  const { pose, missing } = fitLandmarks(state.rig.skel, world, { mirror });
  state.poser.setPose(pose);
  view.setView('front');
  changed();
  view.frameModel();
  setStatus(missing.length
    ? `画像からポーズを作りました（見えなかった部位: ${missing.join('、')}）。点で直せます。`
    : '画像からポーズを作りました。点で直せます。');
}

function showModelState() {
  const ready = !!state.modelBytes;
  $('modelBox').dataset.ready = String(ready);
  $('modelStatus').textContent = ready
    ? 'ポーズモデル: 準備できています（MediaPipe Pose Landmarker / Apache-2.0）。'
    : '推定には MediaPipe のポーズモデル（約 9 MB、初回のみ）が必要です。';
  $('detect').disabled = !ready || !state.image;
}

async function openImageBytes(bytes, name) {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    state.image = { bitmap, name, landmarks: null, world: null };
  } catch {
    setStatus(`画像を読めませんでした: ${name}`);
    return;
  }
  drawReference();
  showModelState();
  if (state.modelBytes) await detect();
  else setStatus('画像を開きました。ポーズモデルを用意すると推定できます。');
}

async function detect() {
  if (!state.image || !state.modelBytes) return;
  $('detect').disabled = true;
  try {
    setStatus('推定の準備中…（初回は数秒かかります）');
    await createDetector(state.modelBytes);
    setStatus('推定中…');
    const r = detectPose(state.image.bitmap);
    if (!r) {
      setStatus('人物を見つけられませんでした。全身がはっきり写った画像で試してください。');
      return;
    }
    state.image.landmarks = r.image;
    state.image.world = r.world;
    drawReference();
    applyLandmarks(r.world);
  } catch (e) {
    setStatus(`推定できませんでした: ${e.message}`);
  } finally {
    showModelState();
  }
}

function setupImage() {
  $('openImage').addEventListener('click', async () => {
    const file = await api.openImage().catch((e) => {
      setStatus(`画像を読めませんでした: ${e.message}`);
      return null;
    });
    if (file) await openImageBytes(file.data, file.name);
  });
  $('detect').addEventListener('click', detect);
  $('mirrorImage').addEventListener('change', () => {
    if (state.image?.world) applyLandmarks(state.image.world);
  });
  $('refClose').addEventListener('click', () => { $('refPanel').hidden = true; });
  api.onPoseModelProgress((ratio) => {
    $('modelProgress').value = ratio;
    setStatus(`ポーズモデルをダウンロード中… ${Math.round(ratio * 100)}%`);
  });
  $('downloadModel').addEventListener('click', async () => {
    $('downloadModel').disabled = true;
    $('modelProgress').hidden = false;
    try {
      state.modelBytes = await api.downloadPoseModel();
      setStatus('ポーズモデルを用意しました。');
      showModelState();
      if (state.image) await detect();
    } catch (e) {
      setStatus(`ダウンロードできませんでした: ${e.message}（「ファイルを選ぶ…」で手元のモデルも使えます）`);
    } finally {
      $('downloadModel').disabled = false;
      $('modelProgress').hidden = true;
    }
  });
  $('chooseModel').addEventListener('click', async () => {
    try {
      const bytes = await api.choosePoseModel();
      if (!bytes) return;
      state.modelBytes = bytes;
      setStatus('ポーズモデルを用意しました。');
      showModelState();
    } catch (e) {
      setStatus(`モデルを使えませんでした: ${e.message}`);
    }
  });
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
    if (/\.vrm$/i.test(file.name)) await useVrmBytes(bytes, file.name);
    else await openImageBytes(bytes, file.name);
  });
}

// ---------------------------------------------------------------- toolbar, keys, context

function edit(fn, message) {
  fn();
  changed();
  if (message) setStatus(message);
}

function setupToolbar() {
  $('undo').addEventListener('click', () => { if (state.poser.undo()) changed(); });
  $('redo').addEventListener('click', () => { if (state.poser.redo()) changed(); });
  $('resetT').addEventListener('click', () => edit(() => state.poser.reset(), 'Tポーズに戻しました。'));
  $('resetStand').addEventListener('click', () => edit(() => state.poser.load(poseById('stand')), '立ちに戻しました。'));
  $('mirror').addEventListener('click', () => edit(() => state.poser.mirror(), '左右を入れ替えました。'));
  $('copyLeft').addEventListener('click', () => edit(() => state.poser.copySide('left'), '左半身を右半身へ写しました。'));
  $('copyRight').addEventListener('click', () => edit(() => state.poser.copySide('right'), '右半身を左半身へ写しました。'));
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view.setView(b.dataset.view));
  $('frame').addEventListener('click', () => view.frameModel());
  $('autoGround').addEventListener('change', (e) => {
    state.poser.autoGround = e.target.checked;
    if (e.target.checked) edit(() => state.poser.ground());
  });
  $('reachAssist').addEventListener('change', (e) => { state.poser.reachAssist = e.target.checked; });
  $('showSkeleton').addEventListener('change', (e) => {
    view.showSkeleton = e.target.checked;
    view.requestRender();
  });
  $('pin').addEventListener('change', () => togglePin());
  $('bone').addEventListener('change', showAngles);
  for (const input of $('angles').querySelectorAll('input')) {
    input.addEventListener('input', () => {
      if (!state.sliderUndo) {
        state.poser.pushUndo();
        state.sliderUndo = true;
      }
      const e = state.poser.boneEuler($('bone').value);
      e[Number(input.dataset.axis)] = Number(input.value);
      state.poser.setBoneEuler($('bone').value, e);
      changed();
    });
    input.addEventListener('change', () => { state.sliderUndo = false; });
  }
  $('resetBone').addEventListener('click', () => edit(() => {
    state.poser.pushUndo();
    state.poser.setBoneEuler($('bone').value, [0, 0, 0]);
  }));
  $('useMannequin').addEventListener('click', useMannequin);
  $('openVrm').addEventListener('click', async () => {
    const file = await api.openVrm().catch(() => null);
    if (file) await useVrmBytes(file.data, file.name);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
    if (e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z' && !e.shiftKey) $('undo').click();
      else if (key === 'y' || (key === 'z' && e.shiftKey)) $('redo').click();
      else if (key === 's') save();
      else return;
      e.preventDefault();
      return;
    }
    if (key === 'p') togglePin();
    else if (key === 'm') $('mirror').click();
    else if (key === 'f') view.frameModel();
    else if (key === '1') view.setView('front');
    else if (key === '3') view.setView('side');
    else if (key === '7') view.setView('top');
    else if (key === 'escape') select(null);
  });
}

/** What the main window asked to edit: its model and its current pose. */
async function applyContext(context) {
  const model = context?.model;
  if (model?.kind === 'vrm' && model.bytes) {
    if (!(await useVrmBytes(model.bytes, model.name ?? 'VRM', model.credit ?? ''))) useMannequin();
  } else {
    useMannequin();
  }
  const pose = context?.pose;
  if (pose?.bones) {
    const isUser = state.userPoses.some((p) => p.id === pose.id);
    loadPose(isUser ? state.userPoses.find((p) => p.id === pose.id) : pose, { asUserPose: isUser });
    state.poser.undoStack = [];
    state.modified = false;
    update();
    showTitle();
  }
  setStatus(`${state.modelName} を編集中。点をドラッグしてポーズを付けます。`);
}

async function main() {
  setupPointer();
  setupPoseList();
  setupImage();
  setupDrop();
  setupToolbar();
  state.userPoses = await api.listPoses().catch(() => []);
  api.onPosesChanged((list) => {
    state.userPoses = list;
    renderUserPoses();
  });
  await applyContext(await api.context());
  api.onContext((ctx) => applyContext(ctx));
  renderUserPoses();
  state.modelBytes = await api.readPoseModel().catch(() => null);
  showModelState();
}

const ready = main().catch((e) => setStatus(`起動に失敗しました: ${e.message}`));

// For GUI tests: state, the view and the landmark entry point (no camera or model needed).
window.__poseEditor = {
  ready,
  state,
  view,
  applyLandmarks,
  handles: Handles,
  /** Screen position of a handle (client pixels). */
  handleScreen(id) {
    view.placeCamera();
    const s = view.toScreen(view.handles.get(id).pos);
    return { x: s.x, y: s.y };
  },
  openImageBytes,
};
