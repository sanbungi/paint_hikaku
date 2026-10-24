import { AlignMode, CanvasSize, DefaultStrokeWidth, OverlayMode, point } from './types.js';
import { Mask, rasterizeStrokes, stampDisc } from './raster.js';
import { alignedUser } from './compare.js';

/** 見本と模写キャンバスが共有する描画状態（GUI 非依存）。 */
export class BoardState {
  constructor(size = CanvasSize) {
    this.size = size;
    this.tpl = new Mask(size, size);
    this.guides = new Mask(size, size);
    this.user = new Mask(size, size);
    this.tplColor = null; // カラーお手本（RGBA、なければ線画表示）
    this.strokes = [];
    this.current = { points: [] };
    this.drawing = false;
    this.resultMode = false;
    this.alignMode = AlignMode.none;
    this.overlay = OverlayMode.overlay;
    this.wipePct = 50;
    this.gridN = 0; // 0=なし, 2/3/4 分割
    this.showBBox = false;
    this.memoryMode = false;
    this.peeking = false;
    this.usePressure = true;
  }

  get sampleVisible() {
    return !this.memoryMode || this.resultMode || this.peeking;
  }

  setTemplate(ink, guides, clearUser, colorRgba = null) {
    this.tpl = ink;
    this.guides = guides;
    this.tplColor = colorRgba;
    if (clearUser) this.clearInk();
    else this.resultMode = false;
  }

  clearInk() {
    this.strokes = [];
    this.current = { points: [] };
    this.drawing = false;
    this.user.clear();
    this.resultMode = false;
  }

  undo() {
    this.strokes.pop();
    this.rebuild();
    this.resultMode = false;
  }

  rebuild() {
    this.user.clear();
    rasterizeStrokes(this.user, this.strokes);
  }

  beginStroke(x, y, pressure) {
    this.drawing = true;
    this.current = { points: [] };
    this.addPoint(x, y, pressure);
  }

  endStroke() {
    if (this.current.points.length) this.strokes.push(this.current);
    this.current = { points: [] };
    this.drawing = false;
  }

  enterResult() {
    if (this.current.points.length) this.endStroke();
    this.rebuild();
    this.resultMode = true;
  }

  addPoint(x, y, pressure) {
    const pts = this.current.points;
    pts.push(point(x, y, pressure));
    const radius = DefaultStrokeWidth * 0.5 * Math.max(0.08, pressure);
    stampDisc(this.user, x, y, radius);
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const dx = x - a.x;
      const dy = y - a.y;
      const n = Math.trunc(Math.hypot(dx, dy));
      for (let i = 1; i < n; i++) stampDisc(this.user, a.x + (dx * i) / n, a.y + (dy * i) / n, radius);
    }
  }

  userAligned() {
    if (this.resultMode && this.alignMode === AlignMode.centroid) {
      return alignedUser(this.tpl, this.user, AlignMode.centroid);
    }
    return this.user;
  }
}
