import { poseById } from './poses.js';

export const MannequinKey = 'mannequin';

/** How the 3D figure is placed in front of the camera. */
export function defaultFigureView() {
  return {
    yawDeg: 25, // 向き: 0 = 正面、+ でモデルの左側が見える
    pitchDeg: 8, // 見下ろし（+）／見上げ（−）
    fovDeg: 35, // 画角: 小さいほど望遠（パースが弱い）
    zoomPct: 100, // 画面に対する大きさ
    panX: 0, // カメラの横ずらし（半画面 = 1、右ドラッグで操作）
    panY: 0, // カメラの縦ずらし
    creases: true, // 輪郭に加えて内部の折れ目も線にする
    floorGuide: true, // 床グリッドと目線（採点対象外）
    display: 'both', // 見本の表示: both=陰影＋線, shaded=陰影のみ, lines=線のみ
  };
}

export const FigureLimits = {
  yawDeg: [-180, 180],
  pitchDeg: [-45, 60],
  fovDeg: [15, 90],
  zoomPct: [50, 160],
  panX: [-1.5, 1.5],
  panY: [-1.5, 1.5],
};

/** Camera fields: changing them needs a new render (「この構図で描く」). */
export const FigureCameraKeys = ['yawDeg', 'pitchDeg', 'fovDeg', 'zoomPct', 'panX', 'panY'];

export function figureTemplateId(modelKey, poseId) {
  return `figure:${modelKey}#${poseId}`;
}

export function parseFigureId(id) {
  const m = /^figure:(.*)#([^#]*)$/.exec(id);
  return m ? { modelKey: m[1], poseId: m[2] } : null;
}

export function figureLabel(id) {
  const f = parseFigureId(id);
  if (!f) return id;
  const model = f.modelKey === MannequinKey ? 'デッサン人形' : f.modelKey.split(/[\\/]/).pop();
  return `${model}・${poseById(f.poseId).labelJa}`;
}

/** Camera distance that fits a bounding sphere of `radius` in a view of `fovDeg`. */
export function fitDistance(radius, fovDeg, zoomPct) {
  const half = (fovDeg * Math.PI) / 360;
  return radius / Math.sin(half) / (zoomPct / 100);
}
