import { composePaper } from '../engine/raster.js';

const Frame = '#e8e6e0';
const Paper = '#ffffff';

/** Fits a canvas's backing store to its CSS size; returns the side in device pixels. */
function fit(canvas) {
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  const side = Math.max(1, Math.round(canvas.clientWidth * scale));
  if (canvas.width !== side || canvas.height !== side) {
    canvas.width = side;
    canvas.height = side;
  }
  return side;
}

/**
 * Draws the sample and the paper at the shared zoom/pan.
 * The sample is the 768² composed raster scaled up; the paper draws the user's strokes as
 * vectors so they stay sharp when zoomed. Scoring always uses the 768² masks.
 */
export class BoardDisplay {
  constructor({ sample, paper, board, pixels, viewport }) {
    Object.assign(this, { sample, paper, board, pixels, viewport });
    const n = viewport.size;
    this.sampleSrc = new OffscreenCanvas(n, n);
    this.guideSrc = new OffscreenCanvas(n, n);
    this.layer = document.createElement('canvas');
    this.layerKey = '';
    this.layerStrokes = null;
    this.layerCount = 0;
    this.current = null;
    this.currentDrawn = 0;
    this.guideKey = '';
  }

  /** Re-composes the 768² sample pixels (template, overlay, guides). */
  composeSample() {
    const n = this.viewport.size;
    this.sampleSrc.getContext('2d').putImageData(new ImageData(this.pixels.sample(), n, n), 0, 0);
  }

  transform(ctx, side) {
    const v = this.viewport;
    const s = v.scale(side);
    ctx.setTransform(s, 0, 0, s, side / 2 - v.cx * s, side / 2 - v.cy * s);
  }

  drawSample() {
    const side = fit(this.sample);
    const ctx = this.sample.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Frame;
    ctx.fillRect(0, 0, side, side);
    this.transform(ctx, side);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.sampleSrc, 0, 0);
  }

  /** Grid / bounding box guides as a transparent overlay for the paper. */
  paperGuides() {
    const b = this.board;
    const g = this.pixels.practiceGuides();
    const key = `${b.gridN}:${b.showBBox}`;
    if (this.guideKey === key && this.guideMask === g) return this.guideSrc;
    this.guideKey = key;
    this.guideMask = g;
    const n = this.viewport.size;
    const rgba = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < g.px.length; i++) {
      if (!g.px[i]) continue;
      rgba.set([200, 205, 215, 255], i * 4);
    }
    this.guideSrc.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0);
    return this.guideSrc;
  }

  drawPaper() {
    const side = fit(this.paper);
    const ctx = this.paper.getContext('2d');
    const n = this.viewport.size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Frame;
    ctx.fillRect(0, 0, side, side);
    this.transform(ctx, side);
    ctx.fillStyle = Paper;
    ctx.fillRect(0, 0, n, n);
    if (this.board.gridN || this.board.showBBox) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.paperGuides(), 0, 0);
    }
    this.updateLayer(side);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
  }

  /** Strokes layer: rebuilt when the view or the stroke list changes, else drawn incrementally. */
  updateLayer(side) {
    const b = this.board;
    const v = this.viewport;
    const key = `${side}:${v.zoom}:${v.cx}:${v.cy}`;
    const strokes = b.strokes;
    // A finished stroke that was drawn live is already on the layer.
    const justFinished = strokes === this.layerStrokes && strokes.length === this.layerCount + 1
      && strokes[strokes.length - 1] === this.current && this.currentDrawn === this.current.points.length;
    const stale = key !== this.layerKey || strokes !== this.layerStrokes
      || (strokes.length !== this.layerCount && !justFinished);
    const ctx = this.layer.getContext('2d');
    if (stale) {
      this.layer.width = side;
      this.layer.height = side;
      this.transform(ctx, side);
      for (const s of strokes) drawStroke(ctx, s, 0);
      this.layerKey = key;
      this.layerStrokes = strokes;
      this.current = null;
      this.currentDrawn = 0;
    }
    this.layerCount = strokes.length;
    if (b.drawing && b.current.points.length) {
      if (this.current !== b.current) {
        this.current = b.current;
        this.currentDrawn = 0;
      }
      this.transform(ctx, side);
      drawStroke(ctx, b.current, Math.max(0, this.currentDrawn - 1));
      this.currentDrawn = b.current.points.length;
    }
  }

  /** RGBA of one pixel in 768² scoring space (for tests and the smoke check). */
  pixelAt(role, x, y) {
    if (role === 'sample') return [...this.sampleSrc.getContext('2d').getImageData(x, y, 1, 1).data];
    const rgba = composePaper(this.board.user);
    const o = (y * this.viewport.size + x) * 4;
    return [...rgba.slice(o, o + 4)];
  }
}

/** Round-capped segments from point `from` on; widths follow pressure like the scoring raster. */
function drawStroke(ctx, s, from) {
  const pts = s.points;
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.color ?? '#1c1c20';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = (p) => (s.width ?? 6) * Math.max(0.08, p.pressure);
  if (pts.length === 1 && from === 0) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, w(pts[0]) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    ctx.beginPath();
    ctx.lineWidth = (w(pts[i - 1]) + w(pts[i])) / 2;
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
