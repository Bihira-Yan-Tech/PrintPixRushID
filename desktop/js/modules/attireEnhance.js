/**
 * AttireEnhance module
 * "Enhance attire" action in the Formal Attire panel — sharpens/
 * upscales the current attire image (default illustration or a
 * user-uploaded PNG). Most useful for a low-resolution uploaded attire
 * photo that looks blurry once scaled up on the canvas; a separate
 * feature from the existing "Auto Enhance" button, which operates on
 * the person's PHOTO, not the attire — see CLAUDE.md.
 *
 * Uses a real 2x super-resolution model (`Xenova/swin2SR-classical-sr-
 * x2-64`) via `@huggingface/transformers` (the actively-maintained
 * successor to transformers.js — wraps onnxruntime-web internally with
 * a clean `pipeline()` API, so this file doesn't hand-roll low-level
 * ONNX tensor pre/post-processing). CDN-loaded on first use, same
 * "needs internet once, then cached" pattern as bgRemoval.js — the
 * model (~19MB, the smallest `uint8`-quantized variant) plus the
 * bundled onnxruntime-web WASM runtime (tens of MB, the same order of
 * magnitude CLAUDE.md's Known Simplifications already cites for why
 * "AI Eraser" was deferred) is too big to self-host in `vendor/` for a
 * feature not every user clicks.
 *
 * An earlier plan used a much smaller model (XLSR, ~172KB) — dropped
 * after discovering during implementation that its only available
 * source (`aplux/XLSR` on Hugging Face) is a gated/private repo
 * (confirmed via a direct request: 401 Unauthorized), not usable
 * without an account. Swin2SR is a real, verified-public alternative;
 * see PROGRESS.md for the full trail.
 */
const AttireEnhance = (() => {

  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers';
  const MODEL_ID = 'Xenova/swin2SR-classical-sr-x2-64';
  const MODEL_DTYPE = 'uint8'; // smallest quantized variant (~19MB)
  // The model's Swin Transformer window size is 64px (see the "-64" in
  // its name) and its own demo processes a 256x256 input to a 512x512
  // output — feeding it a full-resolution image (confirmed via real
  // testing: a 640x640 attire image) instead crashes onnxruntime-web's
  // WASM inference with "failed to call OrtRun(): std::bad_alloc" (a
  // WASM linear-memory allocation failure, not a network/load error).
  // Downscaling to this size first — still a multiple of 64 — keeps
  // memory use predictable and matches the model's own documented
  // usage instead of guessing at what large inputs it can tolerate.
  const MODEL_INPUT_SIZE = 256;

  let upscalerPromise = null;
  let rawImageCtorPromise = null;

  function loadPipeline(onProgress) {
    if (upscalerPromise) return upscalerPromise;
    upscalerPromise = (async () => {
      const { pipeline, RawImage } = await import(TRANSFORMERS_URL);
      rawImageCtorPromise = Promise.resolve(RawImage);
      return pipeline('image-to-image', MODEL_ID, {
        dtype: MODEL_DTYPE,
        progress_callback: onProgress,
      });
    })();
    upscalerPromise.catch(() => { upscalerPromise = null; rawImageCtorPromise = null; });
    return upscalerPromise;
  }

  /**
   * Runs 2x super-resolution on `imageEl` (an <img> or <canvas>) and
   * resolves to a new <canvas> with the sharpened/upscaled result.
   * `onProgress(pct)` is optional, fired while the model downloads (no
   * further signal once inference itself starts, same "downloading vs
   * processing" limitation bgRemoval.js already has). Throws on
   * failure — callers should catch and fall back to using the
   * original image as-is (never block the user from having attire at
   * all just because enhancement failed).
   */
  async function enhance(imageEl, onProgress) {
    let sawDownloadProgress = false;
    const upscaler = await loadPipeline((data) => {
      if (data && typeof data.progress === 'number') {
        sawDownloadProgress = true;
        if (onProgress) onProgress(Math.round(data.progress));
      }
    });
    if (!sawDownloadProgress && onProgress) onProgress(100);

    const RawImage = await rawImageCtorPromise;
    const srcW = imageEl.naturalWidth || imageEl.width;
    const srcH = imageEl.naturalHeight || imageEl.height;
    // Cap at MODEL_INPUT_SIZE on the longest edge — never upscale before
    // feeding the model (an already-small image, the exact case this
    // feature targets, is left as-is so the model's own 2x does the
    // upscaling work).
    const scale = Math.min(1, MODEL_INPUT_SIZE / Math.max(srcW, srcH));
    const drawW = Math.max(1, Math.round(srcW * scale));
    const drawH = Math.max(1, Math.round(srcH * scale));

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = drawW;
    srcCanvas.height = drawH;
    srcCanvas.getContext('2d').drawImage(imageEl, 0, 0, drawW, drawH);

    const input = RawImage.fromCanvas(srcCanvas);
    const output = await upscaler(input);
    // output.toCanvas() returns an OffscreenCanvas, not a real
    // HTMLCanvasElement — it has no toDataURL() (confirmed via real
    // testing: "resultCanvas.toDataURL is not a function"), so redraw
    // it onto one; drawImage() accepts either a real canvas or an
    // OffscreenCanvas as its source, so this works regardless of which
    // one toCanvas() ends up returning.
    const resultSource = output.toCanvas();
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = resultSource.width;
    resultCanvas.height = resultSource.height;
    resultCanvas.getContext('2d').drawImage(resultSource, 0, 0);
    return resultCanvas;
  }

  return { enhance };
})();
