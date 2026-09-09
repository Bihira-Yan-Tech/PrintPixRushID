/**
 * AutoEnhance module
 * "Auto Enhance" button in Step 2 — replaces the old AI Upscale
 * feature. AI Upscale (TensorFlow.js + a super-resolution model) turned
 * out unreliable in practice ("nagloloko" — even after fixing the
 * WebGL-crash bug in aiUpscale.js, the model-download+WebGL pipeline
 * was still a real source of hangs/failures for users). Auto Enhance is
 * plain Canvas 2D pixel math instead: no model, no download, no WebGL,
 * nothing that can "hang" — just deterministic, synchronous math that
 * either finishes or doesn't run at all.
 *
 * What it does, in one pass over the pixel data:
 * 1. Per-channel auto-levels — stretches each of R/G/B so its 0.5th/
 *    99.5th percentile values map to 0/255, correcting flat, hazy, or
 *    color-cast photos (percentile-based, not raw min/max, so a few
 *    outlier pixels can't blow out the stretch).
 * 2. A mild saturation boost (pushes each channel away from the
 *    pixel's own average by a fixed factor).
 * 3. A light unsharp-mask sharpen (3×3 box blur subtracted back off the
 *    original) for a crisper look.
 *
 * Does NOT change pixel dimensions — unlike "upscale," this can't add
 * resolution that was never captured, it only improves the tone/
 * contrast/crispness of what's already there. Runs on the photo at its
 * full actual resolution; a short `setTimeout` yield after setting the
 * "Enhancing…" UI state lets the browser paint that state before the
 * (synchronous, main-thread) pixel loop runs, so a big photo doesn't
 * look like the button did nothing. Deliberately NOT
 * `requestAnimationFrame` for this — rAF callbacks are suspended in
 * backgrounded/hidden browser tabs and would hang this step forever if
 * the user alt-tabbed away right after clicking.
 */
const AutoEnhance = (() => {

  // Deliberately conservative — these are ID photos of people's faces
  // for official documents, so a subtle, safe boost beats an aggressive
  // one that risks clipping/blowing out skin tone detail. Testing with
  // a synthetic narrow-tonal-range image showed 0.5%/99.5% clipping
  // combined with a 1.18 saturation boost could crush shadow-ish
  // channels to 0 on some pixels — tightened to reduce that risk.
  const LOW_PERCENTILE = 0.001;
  const HIGH_PERCENTILE = 0.999;
  const SATURATION_BOOST = 1.10;
  const SHARPEN_AMOUNT = 0.22;

  let enhanceBtn, enhanceBtnText, enhanceHint, enhanceProgress, enhanceProgressFill;
  let defaultHintText = '';

  function cacheDom() {
    enhanceBtn = document.getElementById('enhanceBtn');
    enhanceBtnText = document.getElementById('enhanceBtnText');
    enhanceHint = document.getElementById('enhanceHint');
    enhanceProgress = document.getElementById('enhanceProgress');
    enhanceProgressFill = document.getElementById('enhanceProgressFill');
    defaultHintText = enhanceHint.textContent;
  }

  function setLoading(isLoading, message) {
    enhanceBtn.disabled = isLoading;
    enhanceBtn.classList.toggle('is-loading', isLoading);
    enhanceBtnText.textContent = isLoading ? 'Enhancing…' : 'Auto Enhance';
    enhanceHint.textContent = message || '';
    enhanceProgress.classList.toggle('is-hidden', !isLoading);
    enhanceProgressFill.style.width = isLoading ? '55%' : '0%';
  }

  /**
   * Percentile cutoffs from a single LUMINANCE histogram (not one per
   * channel). Deliberately not independent per-channel stretching: an
   * early version did that and it could shift color balance strongly
   * on photos with a narrow per-channel tonal range (verified in
   * testing — a near-neutral-gray pixel came out visibly blue-tinted).
   * These are ID photos of people's faces for official documents, so
   * an unpredictable color-cast risk from "enhancing" is worse than a
   * milder, safer contrast boost. Applying one shared stretch factor
   * (derived from luminance) to all three channels preserves each
   * pixel's original color ratio exactly — only brightness/contrast
   * changes, never hue.
   */
  function computeLevels(data) {
    const hist = new Uint32Array(256);
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      hist[luma]++;
    }
    const lowCount = pixelCount * LOW_PERCENTILE;
    const highCount = pixelCount * HIGH_PERCENTILE;
    let running = 0, low = 0, high = 255;
    for (let v = 0; v < 256; v++) {
      running += hist[v];
      if (running >= lowCount) { low = v; break; }
    }
    running = 0;
    for (let v = 0; v < 256; v++) {
      running += hist[v];
      if (running >= highCount) { high = v; break; }
    }
    if (high <= low) { low = 0; high = 255; } // degenerate (near-flat) image — skip the stretch
    return { low, high };
  }

  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  /** 3×3 box blur of `data` into a new buffer, edge pixels copied as-is. */
  function boxBlur3x3(data, w, h) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          out[idx] = data[idx]; out[idx + 1] = data[idx + 1]; out[idx + 2] = data[idx + 2]; out[idx + 3] = data[idx + 3];
          continue;
        }
        let r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = ((y + dy) * w + (x + dx)) * 4;
            r += data[nIdx]; g += data[nIdx + 1]; b += data[nIdx + 2];
          }
        }
        out[idx] = r / 9; out[idx + 1] = g / 9; out[idx + 2] = b / 9; out[idx + 3] = data[idx + 3];
      }
    }
    return out;
  }

  /** Runs the full enhance pipeline on `el` (an <img> or <canvas>), returns a new <canvas>. */
  function enhanceToCanvas(el) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(el, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const { low, high } = computeLevels(data);
    const stretchScale = 255 / (high - low);

    for (let i = 0; i < data.length; i += 4) {
      // 1. auto-contrast — one shared low/high stretch applied to all
      // three channels, so color ratios (hue) never shift, only
      // brightness/contrast does.
      let r = clamp255((data[i] - low) * stretchScale);
      let g = clamp255((data[i + 1] - low) * stretchScale);
      let b = clamp255((data[i + 2] - low) * stretchScale);

      // 2. mild saturation boost around this pixel's own average
      const avg = (r + g + b) / 3;
      r = clamp255(avg + (r - avg) * SATURATION_BOOST);
      g = clamp255(avg + (g - avg) * SATURATION_BOOST);
      b = clamp255(avg + (b - avg) * SATURATION_BOOST);

      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }

    // 3. light unsharp-mask sharpen: original + (original - blurred) * amount
    const blurred = boxBlur3x3(data, w, h);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] + (data[i] - blurred[i]) * SHARPEN_AMOUNT);
      data[i + 1] = clamp255(data[i + 1] + (data[i + 1] - blurred[i + 1]) * SHARPEN_AMOUNT);
      data[i + 2] = clamp255(data[i + 2] + (data[i + 2] - blurred[i + 2]) * SHARPEN_AMOUNT);
    }

    ctx.putImageData(imageData, 0, 0);
    return c;
  }

  async function handleEnhance() {
    const photoEl = CanvasEditor.getPhotoElement();
    if (!photoEl) return;

    setLoading(true, 'Enhancing photo…');
    // A setTimeout yield (not requestAnimationFrame) — rAF callbacks are
    // suspended in backgrounded/hidden browser tabs and would hang this
    // forever if the user alt-tabbed away right after clicking.
    await new Promise((resolve) => setTimeout(resolve, 30));

    try {
      const resultCanvas = enhanceToCanvas(photoEl);
      const img = new Image();
      img.onload = () => {
        CanvasEditor.setEnhancedPhoto(img);
        setLoading(false, 'Photo enhanced — levels, color, and sharpness adjusted.');
      };
      img.onerror = () => setLoading(false, 'Enhance finished but the result could not be loaded.');
      img.src = resultCanvas.toDataURL('image/png');
    } catch (err) {
      console.error('Auto Enhance failed:', err);
      setLoading(false, 'Enhance failed — try again, or check the browser console.');
    }
  }

  function init() {
    cacheDom();
    enhanceBtn.addEventListener('click', handleEnhance);

    document.addEventListener('upload:change', () => {
      enhanceBtn.disabled = false;
      setLoading(false, defaultHintText);
    });
    // 'upload:change' only fires for a brand-new upload — a restored job
    // (autosave/Open Job/Recopy/Import) never fires it (the original
    // File doesn't survive a save/reload), so this button stayed
    // permanently disabled after a restore despite a photo clearly being
    // loaded. Found via testing while building the AI Formal Attire
    // Assistant (same bug hit that button too — see formalAttireCommand.js).
    document.addEventListener('job:applied', () => {
      // Order matters: setLoading(false, ...) itself writes
      // enhanceBtn.disabled = false (isLoading) as part of resetting the
      // loading UI — calling it AFTER the line below would silently
      // re-enable the button even for a job with no photo (a restore to
      // a truly blank job would leave Auto Enhance clickable with
      // nothing to enhance). Real bug found via audit: this used to run
      // setLoading() second, clobbering the correct disabled state that
      // was just set. setLoading() first, then the real disabled value
      // last, so it's the one that sticks.
      setLoading(false, defaultHintText);
      enhanceBtn.disabled = !CanvasEditor.getPhotoElement();
    });
  }

  return { init };
})();
