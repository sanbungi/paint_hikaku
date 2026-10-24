/**
 * Shared zoom/pan of the sample and the paper, so both always show the same region.
 * Canvas space is the 768² scoring space; `cx, cy` is the canvas point shown at the centre
 * of the board, `zoom` = 1 fits the whole canvas into the board square.
 */
export const ZoomLimits = [1, 12];

export class Viewport {
  constructor(size) {
    this.size = size;
    this.reset();
  }

  reset() {
    this.zoom = 1;
    this.cx = this.size / 2;
    this.cy = this.size / 2;
  }

  /** Display pixels per canvas pixel for a board square of `side` display pixels. */
  scale(side) {
    return (side / this.size) * this.zoom;
  }

  /** Canvas → display (relative to the board square's top-left). */
  toDisplay(x, y, side) {
    const s = this.scale(side);
    return { x: side / 2 + (x - this.cx) * s, y: side / 2 + (y - this.cy) * s };
  }

  /** Display (relative to the board square) → canvas. */
  toCanvas(x, y, side) {
    const s = this.scale(side);
    return { x: this.cx + (x - side / 2) / s, y: this.cy + (y - side / 2) / s };
  }

  /** Keeps the view on the canvas: at zoom 1 it is centred, zoomed in it cannot leave the paper. */
  clamp() {
    this.zoom = Math.max(ZoomLimits[0], Math.min(ZoomLimits[1], this.zoom));
    const half = this.size / 2 / this.zoom;
    this.cx = Math.max(half, Math.min(this.size - half, this.cx));
    this.cy = Math.max(half, Math.min(this.size - half, this.cy));
  }

  /** Zooms by `factor` keeping the canvas point under display (dx, dy) fixed. */
  zoomAt(factor, dx, dy, side) {
    const before = this.toCanvas(dx, dy, side);
    this.zoom *= factor;
    this.clamp();
    const after = this.toCanvas(dx, dy, side);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clamp();
  }

  /** Moves the paper by display pixels (hand tool: the paper follows the pointer). */
  panBy(ddx, ddy, side) {
    const s = this.scale(side);
    this.cx -= ddx / s;
    this.cy -= ddy / s;
    this.clamp();
  }
}
