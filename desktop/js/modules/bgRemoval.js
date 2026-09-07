/**
 * BgRemoval module
 * Wires up the "Remove background" action and the background swatches
 * (solid colors + custom color + custom background image). Actual
 * background removal runs fully client-side via @imgly/background-removal
 * (WASM), loaded on demand from a CDN the first time it's used — after
 * that first download the model is cached by the browser, matching the
 * app's offline-first intent.
 *
 * This module only decides *what* the subject/background should be; the
 * actual drawing is owned by CanvasEditor (setCutout / setBackgroundColor
 * / setBackgroundImage / clearBackground), which also re-broadcasts
 * "photo:change" so the Live Preview pane stays in sync automatically.
 *
 * removeBackgroundFromFile() is also reused by attireControls.js — a
 * custom-uploaded attire PNG gets run through the same model so it
 * overlays cleanly even if the user didn't already cut it out
 * themselves, instead of duplicating the CDN-loading logic there.
 */
const BgRemoval = (() => {

  let removeBgBtn, removeBgBtnText, removeBgHint, bgSection;
  let removeBgProgress, removeBgProgressFill;
  let swatchRow, customColorInput, customBgBtn, customBgInput;

  let removeBackgroundFn = null; // cached after the first dynamic import

  function cacheDom() {
    removeBgBtn = document.getElementById('removeBgBtn');
    removeBgBtnText = document.getElementById('removeBgBtnText');
    removeBgHint = document.getElementById('removeBgHint');
    removeBgProgress = document.getElementById('removeBgProgress');
    removeBgProgressFill = document.getElementById('removeBgProgressFill');
    bgSection = document.getElementById('bgSection');
    swatchRow = document.getElementById('swatchRow');
    customColorInput = document.getElementById('customColorInput');
    customBgBtn = document.getElementById('customBgBtn');
    customBgInput = document.getElementById('customBgInput');
  }

  function setSwatchActive(el) {
    swatchRow.querySelectorAll('.swatch').forEach(s => s.classList.remove('is-active'));
    if (el) el.classList.add('is-active');
  }

  function setLoading(isLoading, message) {
    removeBgBtn.disabled = isLoading;
    removeBgBtn.classList.toggle('is-loading', isLoading);
    removeBgBtnText.textContent = isLoading ? 'Removing background…' : 'Remove background';
    removeBgHint.textContent = message || '';
    removeBgProgress.classList.toggle('is-hidden', !isLoading);
    if (!isLoading) setProgress(0);
  }

  function setProgress(pct) {
    removeBgProgressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  /** Loads the background-removal model from CDN, once, and caches the fn. */
  async function loadModel() {
    if (removeBackgroundFn) return removeBackgroundFn;
    const mod = await import('https://esm.run/@imgly/background-removal');
    removeBackgroundFn = mod.removeBackground;
    return removeBackgroundFn;
  }

  /**
   * Runs the shared bg-removal model on any image `file` and resolves to
   * the cut-out result as an HTMLImageElement. `onProgress(pct, phase)`
   * is optional — `phase` is `'downloading'` while the (key, current,
   * total) callback is still firing for model assets, then `'processing'`
   * once downloads are done and the WASM inference itself is running
   * (which has no further progress signal of its own).
   */
  async function removeBackgroundFromFile(file, onProgress) {
    const removeBackground = await loadModel();
    let sawDownloadProgress = false;
    const blob = await removeBackground(file, {
      progress: (key, current, total) => {
        sawDownloadProgress = true;
        const pct = total ? Math.round((current / total) * 100) : 0;
        if (onProgress) onProgress(pct, pct < 100 ? 'downloading' : 'processing');
      },
    });
    if (!sawDownloadProgress && onProgress) onProgress(100, 'processing');

    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => reject(new Error('Could not read the processed image.'));
      img.src = url;
    });
  }

  async function handleRemoveBg() {
    const file = CanvasEditor.getOriginalFile();
    if (!file) return;

    setLoading(true, 'First run downloads a small AI model — needs an internet connection once.');
    setProgress(0);

    try {
      const img = await removeBackgroundFromFile(file, (pct, phase) => {
        setProgress(pct);
        removeBgHint.textContent = phase === 'downloading' ? `Downloading model… ${pct}%` : 'Processing photo…';
      });
      CanvasEditor.setCutout(img);
      bgSection.classList.remove('is-hidden');
      setLoading(false, 'Background removed. Pick a color below, or upload your own.');
    } catch (err) {
      console.error('Background removal failed:', err);
      setLoading(false, 'Background removal failed — check your connection and try again.');
    }
  }

  function handleCustomBgFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      CanvasEditor.setBackgroundImage(img);
      setSwatchActive(null);
    };
    img.src = url;
  }

  function wireEvents() {
    removeBgBtn.addEventListener('click', handleRemoveBg);

    swatchRow.addEventListener('click', (e) => {
      const btn = e.target.closest('.swatch');
      if (!btn || btn.classList.contains('swatch-custom')) return;
      setSwatchActive(btn);
      const color = btn.dataset.color;
      if (color === '') {
        CanvasEditor.clearBackground();
      } else {
        CanvasEditor.setBackgroundColor(color);
      }
    });

    customColorInput.addEventListener('input', (e) => {
      setSwatchActive(customColorInput.closest('.swatch'));
      CanvasEditor.setBackgroundColor(e.target.value);
    });

    customBgBtn.addEventListener('click', () => customBgInput.click());
    customBgInput.addEventListener('change', (e) => handleCustomBgFile(e.target.files[0]));

    // Reset this panel whenever a fresh photo comes in via CanvasEditor.
    document.addEventListener('upload:change', () => {
      bgSection.classList.add('is-hidden');
      setSwatchActive(swatchRow.querySelector('.is-transparent'));
      setLoading(false, '');
      removeBgBtn.disabled = false;
    });

    // Undo/redo restores CanvasEditor's internal state directly (same as
    // Recopy) without going through this panel's own swatches — re-sync
    // afterward so the active swatch shown here matches reality.
    document.addEventListener('editstate:restored', (e) => syncUI(e.detail.background, !!e.detail.photoDataUrl));
  }

  /**
   * Syncs this panel's own swatches/visibility to match restored state —
   * used by Save/Recopy (Step 5) after CanvasEditor.loadState() has
   * already applied the actual background to the canvas. Purely
   * cosmetic: does not call back into CanvasEditor.
   *
   * Also re-enables removeBgBtn when a restored job has a photo — found
   * missing during testing: this button only ever enabled via
   * 'upload:change' (a brand-new upload), never on a restored job
   * (autosave/Open Job/Recopy/Import don't fire that event at all — the
   * original File doesn't survive a save/reload), so it stayed
   * permanently disabled after "Continue where you left off" despite a
   * photo clearly being loaded. Same bug hit Auto Enhance and the new
   * Add Formal Attire button too — see those files.
   */
  function syncUI(background, hasPhoto) {
    removeBgBtn.disabled = !hasPhoto;
    bgSection.classList.toggle('is-hidden', !hasPhoto);
    const mode = background ? background.mode : 'none';

    if (mode === 'color') {
      const swatch = swatchRow.querySelector(`.swatch[data-color="${CSS.escape(background.color)}"]`);
      if (swatch) {
        setSwatchActive(swatch);
      } else {
        customColorInput.value = background.color;
        setSwatchActive(customColorInput.closest('.swatch'));
      }
    } else if (mode === 'image') {
      setSwatchActive(null);
    } else {
      setSwatchActive(swatchRow.querySelector('.is-transparent'));
    }
  }

  function init() {
    cacheDom();
    wireEvents();
  }

  return { init, syncUI, removeBackgroundFromFile };
})();
