import { AlignMode } from './types.js';
import { BoardState } from './board.js';
import { samePixels } from './raster.js';
import { renderTemplate } from './templates.js';
import { isSolidId } from './solids.js';
import { diagnose } from './diagnose.js';
import { defaultPerspective } from './perspective.js';
import { nowIso } from './trend.js';

/** Shared application commands. Widgets and regression scenarios use this same state. */
export class PracticeSession {
  constructor({ writeRecord = async () => {}, timestamp = nowIso } = {}) {
    this.board = new BoardState();
    this.templateId = 'circle';
    this.perspective = defaultPerspective();
    this.saved = false;
    this.saving = false;
    this.peekGeneration = 0;
    this.writeRecord = writeRecord;
    this.timestamp = timestamp;
  }

  stopPeek() {
    this.peekGeneration++;
    this.board.peeking = false;
  }

  peek() {
    this.board.peeking = this.board.memoryMode;
    return ++this.peekGeneration;
  }

  expirePeek(generation) {
    if (generation === this.peekGeneration) this.board.peeking = false;
  }

  memory(enabled) {
    this.stopPeek();
    this.board.memoryMode = enabled;
  }

  select(id) {
    const r = renderTemplate(id, this.perspective);
    this.setTemplate(id, r.ink, r.guides);
  }

  setTemplate(id, ink, guides, color = null) {
    this.stopPeek();
    this.templateId = id;
    this.board.setTemplate(ink, guides, true, color);
    this.saved = false;
  }

  adjustPerspective(settings) {
    this.perspective = { ...settings };
    if (!isSolidId(this.templateId)) return;
    const r = renderTemplate(this.templateId, this.perspective);
    if (samePixels(r.ink.px, this.board.tpl.px)) {
      // Guide-only change: keep the result (and its saved state).
      this.board.guides = r.guides;
      return;
    }
    this.board.setTemplate(r.ink, r.guides, false);
    this.saved = false;
  }

  /** Re-rendered template of the same subject (e.g. a new camera angle): the drawing stays. */
  adjustTemplate(ink, guides, color = null) {
    if (samePixels(ink.px, this.board.tpl.px)) {
      // Display-only change: keep the result (and its saved state).
      this.board.guides = guides;
      this.board.tplColor = color;
      return;
    }
    this.board.setTemplate(ink, guides, false, color);
    this.saved = false;
  }

  clear() {
    this.board.clearInk();
    this.saved = false;
  }

  undo() {
    this.board.undo();
    this.saved = false;
  }

  check() {
    // Rechecking an unchanged result must not allow duplicate records.
    if (!this.board.resultMode) {
      this.board.enterResult();
      this.saved = false;
    }
  }

  setAlignment(mode) {
    if (this.board.alignMode !== mode) this.saved = false;
    this.board.alignMode = mode;
  }

  diagnose() {
    const b = this.board;
    return diagnose(b.tpl, b.user, b.strokes, b.alignMode);
  }

  /** Resolves true when a record was written; false when there is nothing new to save. */
  async save() {
    if (!this.board.resultMode || this.saved || this.saving) return false;
    const result = this.diagnose();
    const record = {
      isoTime: this.timestamp(),
      templateId: this.templateId,
      alignMode: this.board.alignMode === AlignMode.none ? 'none' : 'centroid',
      metrics: result.metrics,
      commentsJa: result.commentsJa,
    };
    this.saving = true;
    try {
      await this.writeRecord(record); // Only mark saved after a successful write.
    } finally {
      this.saving = false;
    }
    this.saved = true;
    return true;
  }
}
