import { poseById } from './poses.js';

export const MannequinKey = 'mannequin';

/** How the 3D figure is placed in front of the camera. */
export function defaultFigureView() {
  return {
    yawDeg: 25, // 向き: 0 = 正面、+ でモデルの左側が見える
    pitchDeg: 8, // 見下ろし（+）／見上げ（−）
    fovDeg: 35, // 画角: 小さいほど望遠（パースが弱い）
    zoomPct: 100, // 画面に対する大きさ
    panX: 0, // カメラの横ずらし（人物の大きさ＝外接球の半径が 1）
    panY: 0, // カメラの縦ずらし
    lineWidth: 2.5, // 採点する線の太さ（px、768² 上）
    creases: true, // 輪郭に加えて内部の折れ目も線にする
    floorGuide: true, // 床グリッドと目線（採点対象外）
    display: 'both', // 見本の表示: both=陰影＋線, shaded=陰影のみ, lines=線のみ
  };
}

export const FigureLimits = {
  yawDeg: [-180, 180],
  pitchDeg: [-45, 60],
  fovDeg: [15, 90],
  zoomPct: [20, 800],
  panX: [-1.5, 1.5],
  panY: [-1.5, 1.5],
  lineWidth: [1, 8],
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

/** Margin around the figure when it just fits the frame. */
export const FitMargin = 1.04;

/**
 * Camera distance that fits a bounding sphere of `radius` in a view of `fovDeg`.
 * Below 100% the camera backs off; above, it stays and the lens zooms (a crop), so close-ups
 * keep the perspective chosen with the field of view and never put the camera inside the model.
 */
export function fitDistance(radius, fovDeg, zoomPct) {
  const half = (fovDeg * Math.PI) / 360;
  return (radius * FitMargin) / Math.sin(half) / Math.min(1, zoomPct / 100);
}

/** Lens zoom factor (three.js PerspectiveCamera.zoom) for a zoom percentage. */
export function lensZoom(zoomPct) {
  return Math.max(1, zoomPct / 100);
}

/** Half the frame height at the figure, in units of its bounding radius (for pan dragging). */
export function halfFrameInRadius(fovDeg, zoomPct) {
  const half = (fovDeg * Math.PI) / 360;
  return FitMargin / Math.cos(half) / (zoomPct / 100);
}
