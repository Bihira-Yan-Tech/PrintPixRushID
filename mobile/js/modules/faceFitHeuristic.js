/**
 * FaceFitHeuristic
 * Formerly part of attireRenderer.js (which also drew the default
 * male/female vector-illustration attire — removed along with the old
 * manual attire-overlay system in favor of AiAttireAssistant, see
 * CLAUDE.md). This one function survives because "Auto-fit face" is a
 * separate, unrelated feature that isn't going anywhere.
 */
const FaceFitHeuristic = (() => {

  /**
   * Returns a source-rect {sx, sy, sw, sh} that crops the lower portion
   * of the photo away and matches the target frame's aspect ratio — a
   * simple heuristic stand-in for real face detection, used by the
   * "Auto-fit face" one-shot action.
   */
  function computeFaceFitCrop(img, targetW, targetH) {
    const HEAD_ROOM = 0.72; // keep the top 72% of the photo, drop the rest
    const srcW = img.width;
    const srcH = img.height * HEAD_ROOM;
    const targetAspect = targetW / targetH;
    const cropAspect = srcW / srcH;

    let sx, sy, sw, sh;
    if (cropAspect > targetAspect) {
      sh = srcH;
      sw = sh * targetAspect;
      sx = (srcW - sw) / 2;
      sy = 0;
    } else {
      sw = srcW;
      sh = sw / targetAspect;
      sx = 0;
      sy = 0;
    }
    return { sx, sy, sw, sh };
  }

  return { computeFaceFitCrop };
})();
