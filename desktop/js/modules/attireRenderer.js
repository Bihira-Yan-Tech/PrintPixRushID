/**
 * AttireRenderer
 * Renders the default male/female formal-attire illustrations once, to an
 * offscreen canvas, and hands back a cached PNG data URL — NOT a live
 * per-frame draw function anymore. This is what lets a default attire and
 * a user-uploaded attire PNG go through the exact same code path in
 * CanvasEditor: both are just image sources for a Fabric.Image object that
 * the user can select/drag/resize independently of the photo.
 *
 * Honesty note: this is still a vector illustration (gradients, lapels,
 * buttons for a bit of dimension), not a photo of real clothing — "no
 * external image downloads" was the deliberate tradeoff here. A user who
 * wants a real look uploads their own transparent PNG instead.
 *
 * Also keeps computeFaceFitCrop(), reused by the "Auto-fit face" one-shot
 * button in canvasEditor.js.
 */
const AttireRenderer = (() => {

  const SIZE = 640; // offscreen render resolution, square
  const cache = {}; // gender -> data URL, filled on first request

  function buildSuitGradient(ctx, gender, topY, h) {
    const g = ctx.createLinearGradient(0, topY, 0, SIZE);
    if (gender === 'female') {
      g.addColorStop(0, '#6B7794');
      g.addColorStop(0.5, '#4B5670');
      g.addColorStop(1, '#39415A');
    } else {
      g.addColorStop(0, '#2B3A5C');
      g.addColorStop(0.5, '#1E2A44');
      g.addColorStop(1, '#141C30');
    }
    return g;
  }

  /** Draws one refined attire illustration into a fresh SIZE×SIZE canvas. */
  function renderAttireCanvas(gender) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const w = SIZE, h = SIZE;
    const topY = h * 0.58;
    const shirtColor = '#FBFBFE';
    const accentColor = gender === 'female' ? '#B45309' : '#7A1F2B';

    ctx.clearRect(0, 0, w, h);

    // shoulders + torso silhouette, gradient-shaded for a bit of fabric depth
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w * 0.05, topY + h * 0.11);
    ctx.quadraticCurveTo(w * 0.22, topY - h * 0.03, w * 0.40, topY + h * 0.015);
    ctx.lineTo(w * 0.47, topY + h * 0.10);
    ctx.lineTo(w * 0.53, topY + h * 0.10);
    ctx.lineTo(w * 0.60, topY + h * 0.015);
    ctx.quadraticCurveTo(w * 0.78, topY - h * 0.03, w * 0.95, topY + h * 0.11);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = buildSuitGradient(ctx, gender, topY, h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = w * 0.004;
    ctx.stroke();

    // lapels — two triangles, slightly lighter than the base suit, for visual separation
    const lapelColor = gender === 'female' ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.07)';
    ctx.fillStyle = lapelColor;
    ctx.beginPath();
    ctx.moveTo(w * 0.40, topY + h * 0.015);
    ctx.lineTo(w * 0.47, topY + h * 0.10);
    ctx.lineTo(w * 0.34, topY + h * 0.30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.60, topY + h * 0.015);
    ctx.lineTo(w * 0.53, topY + h * 0.10);
    ctx.lineTo(w * 0.66, topY + h * 0.30);
    ctx.closePath();
    ctx.fill();

    // shirt/blouse collar gap
    ctx.beginPath();
    ctx.moveTo(w * 0.40, topY + h * 0.015);
    ctx.lineTo(w * 0.47, topY + h * 0.10);
    ctx.lineTo(w * 0.50, topY + h * 0.17);
    ctx.closePath();
    ctx.fillStyle = shirtColor;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.60, topY + h * 0.015);
    ctx.lineTo(w * 0.53, topY + h * 0.10);
    ctx.lineTo(w * 0.50, topY + h * 0.17);
    ctx.closePath();
    ctx.fill();

    if (gender === 'male') {
      // tie, with a soft center highlight stripe
      ctx.beginPath();
      ctx.moveTo(w * 0.47, topY + h * 0.10);
      ctx.lineTo(w * 0.53, topY + h * 0.10);
      ctx.lineTo(w * 0.516, h);
      ctx.lineTo(w * 0.484, h);
      ctx.closePath();
      const tieGrad = ctx.createLinearGradient(w * 0.47, topY, w * 0.53, topY);
      tieGrad.addColorStop(0, accentColor);
      tieGrad.addColorStop(0.5, '#9C3444');
      tieGrad.addColorStop(1, accentColor);
      ctx.fillStyle = tieGrad;
      ctx.fill();

      // suit buttons
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      [0.40, 0.48].forEach((t) => {
        ctx.beginPath();
        ctx.arc(w * 0.5, topY + h * (0.25 + t * 0.6), w * 0.009, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      // blouse bow/brooch accent
      ctx.beginPath();
      ctx.arc(w * 0.5, topY + h * 0.22, Math.max(3, w * 0.014), 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - w * 0.03, topY + h * 0.22);
      ctx.quadraticCurveTo(w * 0.5, topY + h * 0.18, w * 0.5 + w * 0.03, topY + h * 0.22);
      ctx.quadraticCurveTo(w * 0.5, topY + h * 0.26, w * 0.5 - w * 0.03, topY + h * 0.22);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
    }

    // subtle top-light highlight across the shoulder line for a little dimension
    const highlight = ctx.createLinearGradient(0, topY, 0, topY + h * 0.08);
    highlight.addColorStop(0, 'rgba(255,255,255,0.16)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.moveTo(w * 0.05, topY + h * 0.11);
    ctx.quadraticCurveTo(w * 0.22, topY - h * 0.03, w * 0.40, topY + h * 0.015);
    ctx.lineTo(w * 0.60, topY + h * 0.015);
    ctx.quadraticCurveTo(w * 0.78, topY - h * 0.03, w * 0.95, topY + h * 0.11);
    ctx.lineTo(w * 0.95, topY + h * 0.19);
    ctx.lineTo(w * 0.05, topY + h * 0.19);
    ctx.closePath();
    ctx.fill();

    return canvas;
  }

  /** Cached PNG data URL for the default illustration ('male' | 'female'). */
  function getDefaultAttireDataUrl(gender) {
    const key = gender === 'female' ? 'female' : 'male';
    if (!cache[key]) {
      cache[key] = renderAttireCanvas(key).toDataURL('image/png');
    }
    return cache[key];
  }

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

  return { getDefaultAttireDataUrl, computeFaceFitCrop };
})();
