import { OverlayMode } from './types.js';
import { composeHiddenSample, composeOverlay, composePaper, composeSample, composeWipe, distanceTransform } from './raster.js';
import { overlayGuides, practiceGuides } from './grid.js';

/**
 * Pixels for the two on-screen boards. Caches what only changes with the template
 * (practice guides, heat distance field) so drawing a stroke stays cheap.
 */
export class BoardRenderer {
  constructor(board) {
    this.board = board;
    this.guideKey = null;
    this.guideMask = null;
    this.guideTpl = null;
    this.heatTpl = null;
    this.heatDt = null;
  }

  practiceGuides() {
    const b = this.board;
    const key = `${b.gridN}:${b.showBBox}`;
    if (this.guideMask === null || this.guideKey !== key || this.guideTpl !== b.tpl) {
      this.guideMask = practiceGuides(b.size, b.gridN, b.tpl, b.showBBox);
      this.guideKey = key;
      this.guideTpl = b.tpl;
    }
    return this.guideMask;
  }

  heat() {
    if (this.heatTpl !== this.board.tpl) {
      this.heatDt = distanceTransform(this.board.tpl);
      this.heatTpl = this.board.tpl;
    }
    return this.heatDt;
  }

  /** 練習中はお手本のみ。答え合わせ後は合成／スライド。 */
  sample() {
    const b = this.board;
    if (!b.sampleVisible) return composeHiddenSample(b.size, b.size);
    const pg = this.practiceGuides();
    let rgba;
    if (b.resultMode) {
      const user = b.userAligned();
      if (b.overlay === OverlayMode.wipe) rgba = composeWipe(b.tpl, user, b.guides, b.wipePct, b.tplColor);
      else {
        const heat = b.overlay === OverlayMode.heat ? this.heat() : null;
        rgba = composeOverlay(b.tpl, user, b.overlay, heat, b.tplColor);
      }
      overlayGuides(rgba, pg, 180, 186, 196);
    } else {
      rgba = composeSample(b.tpl, b.guides, b.tplColor);
      overlayGuides(rgba, pg, 190, 188, 178);
    }
    return rgba;
  }

  /**
   * 真っ白な紙に自分の線だけ（見本は混ぜない）。位置合わせは見本側の重ねにだけ使い、
   * 紙は描いた位置のまま（答え合わせ後に加筆しても線がずれない）。
   */
  paper() {
    const rgba = composePaper(this.board.user);
    overlayGuides(rgba, this.practiceGuides(), 200, 205, 215);
    return rgba;
  }
}
