/** 割り当て矩形に収まる最大の正方形。論理解像度と無関係に表示を拡縮する。 */
export function squareView(left, top, width, height, maxSide = Infinity, valign = 'center') {
  const side = Math.min(width, height, maxSide);
  if (!(side >= 1)) return { x: 0, y: 0, w: 0, h: 0, empty: true };
  const x = left + (width - side) / 2;
  const y = valign === 'top' ? top : top + (height - side) / 2;
  return { x, y, w: side, h: side, empty: false };
}

/** 画像をキャンバスにレターボックスする描画先矩形（縦横比を保持）。 */
export function fitRect(sw, sh, size) {
  if (!(sw >= 1 && sh >= 1)) return { x: 0, y: 0, w: size, h: size };
  const sc = Math.min(size / sw, size / sh);
  const w = Math.max(1, Math.trunc(sw * sc));
  const h = Math.max(1, Math.trunc(sh * sc));
  return { x: Math.trunc((size - w) / 2), y: Math.trunc((size - h) / 2), w, h };
}
