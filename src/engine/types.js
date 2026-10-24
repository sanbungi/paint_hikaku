export const CanvasSize = 768;
export const DefaultStrokeWidth = 6.0;

export const AlignMode = Object.freeze({ none: 'none', centroid: 'centroid' });
export const OverlayMode = Object.freeze({ overlay: 'overlay', diff: 'diff', heat: 'heat', wipe: 'wipe' });

/** @returns {{x:number, y:number, pressure:number, timeMs:number}} */
export function point(x, y, pressure = 1, timeMs = 0) {
  return { x, y, pressure, timeMs };
}

export function createMetrics() {
  return {
    iou: 0,
    chamferUserToTpl: 0,
    chamferTplToUser: 0,
    missRate: 0, // template pixels not covered
    extraRate: 0, // user pixels not on template
    dx: 0,
    dy: 0,
    scaleRatio: 1,
    aspectRatio: 1,
    angleDeg: 0,
    jitter: 0,
    coverTL: 0,
    coverTR: 0,
    coverBL: 0,
    coverBR: 0,
  };
}

/** Keys persisted in session JSON (same set as the D version). */
export const SavedMetricKeys = [
  'iou', 'chamferUserToTpl', 'chamferTplToUser', 'missRate', 'extraRate',
  'dx', 'dy', 'scaleRatio', 'aspectRatio', 'angleDeg', 'jitter',
];
