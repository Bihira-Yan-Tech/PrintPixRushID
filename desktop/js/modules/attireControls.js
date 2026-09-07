/**
 * AttireControls module
 * Wires up the "Formal attire" toggle, the Male/Female preset buttons,
 * "Align to photo" (see CanvasEditor.alignAttireToPhoto() — tries real
 * shoulder detection via PoseDetection first, falls back to a position
 * heuristic), "Enhance attire" (sharpens/upscales the current attire
 * image via AttireEnhance — separate from the photo-level "Auto
 * Enhance" button), the "Upload your own" custom attire button, and the
 * opacity slider in the Upload & Edit panel. The actual attire object
 * (selectable/draggable/resizable on the canvas) lives in CanvasEditor;
 * this module only translates UI events into CanvasEditor.setAttire*()
 * calls.
 *
 * Uploaded attire is run through BgRemoval.removeBackgroundFromFile()
 * automatically — the same AI background-removal model used for the
 * main photo — so it overlays cleanly even if the user's PNG wasn't
 * already transparent. If that fails (e.g. no internet on first use),
 * it falls back to using the upload as-is rather than blocking it.
 *
 * "Auto-fit face" is no longer here — it's a one-shot action button
 * wired directly in canvasEditor.js (CanvasEditor.autoFitFace()), since
 * it doesn't need any UI state of its own anymore.
 */
const AttireControls = (() => {

  let attireToggle, attireControlsBox, genderToggle, opacityRange;
  let uploadBtn, uploadBtnText, uploadInput, uploadProgress, uploadProgressFill, uploadHintEl;
  let alignBtn, alignBtnText, alignProgress, alignProgressFill, alignHint;
  let enhanceAttireBtn, enhanceAttireBtnText, enhanceAttireProgress, enhanceAttireProgressFill, enhanceAttireHint;

  function cacheDom() {
    attireToggle = document.getElementById('attireToggle');
    attireControlsBox = document.getElementById('attireControls');
    genderToggle = document.getElementById('attireGenderToggle');
    opacityRange = document.getElementById('attireOpacity');
    uploadBtn = document.getElementById('attireUploadBtn');
    uploadBtnText = document.getElementById('attireUploadBtnText');
    uploadInput = document.getElementById('attireUploadInput');
    uploadProgress = document.getElementById('attireUploadProgress');
    uploadProgressFill = document.getElementById('attireUploadProgressFill');
    uploadHintEl = document.getElementById('attireUploadHint');
    alignBtn = document.getElementById('attireAlignBtn');
    alignBtnText = document.getElementById('attireAlignBtnText');
    alignProgress = document.getElementById('attireAlignProgress');
    alignProgressFill = document.getElementById('attireAlignProgressFill');
    alignHint = document.getElementById('attireAlignHint');
    enhanceAttireBtn = document.getElementById('attireEnhanceBtn');
    enhanceAttireBtnText = document.getElementById('attireEnhanceBtnText');
    enhanceAttireProgress = document.getElementById('attireEnhanceProgress');
    enhanceAttireProgressFill = document.getElementById('attireEnhanceProgressFill');
    enhanceAttireHint = document.getElementById('attireEnhanceHint');
  }

  function setGenderActive(gender) {
    genderToggle.querySelectorAll('.seg-btn').forEach(b =>
      b.classList.toggle('is-active', b.dataset.gender === gender)
    );
  }

  function setUploadProgress(pct) {
    uploadProgressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function imageElementToDataUrl(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  }

  async function handleUploadFile(file) {
    if (!file) return;
    setGenderActive(null); // neither preset represents the uploaded image

    uploadBtn.disabled = true;
    uploadBtnText.textContent = 'Removing background…';
    uploadProgress.classList.remove('is-hidden');
    setUploadProgress(0);
    uploadHintEl.textContent = 'First use downloads a small AI model — needs an internet connection once.';

    try {
      const cutoutImg = await BgRemoval.removeBackgroundFromFile(file, (pct, phase) => {
        setUploadProgress(pct);
        uploadHintEl.textContent = phase === 'downloading' ? `Downloading model… ${pct}%` : 'Removing background…';
      });
      CanvasEditor.setAttireCustomImage(imageElementToDataUrl(cutoutImg));
      uploadHintEl.textContent = 'Background removed automatically. Drag/resize the attire to fit.';
    } catch (err) {
      console.error('Attire background removal failed, using the upload as-is:', err);
      const rawDataUrl = await readFileAsDataUrl(file);
      CanvasEditor.setAttireCustomImage(rawDataUrl);
      uploadHintEl.textContent = 'Could not auto-remove the background (check your connection) — using your upload as-is. A transparent PNG still overlays cleanest.';
    } finally {
      uploadBtn.disabled = false;
      uploadBtnText.textContent = 'Upload your own attire';
      uploadProgress.classList.add('is-hidden');
    }
  }

  async function handleAlign() {
    alignBtn.disabled = true;
    alignBtnText.textContent = 'Aligning…';
    alignProgress.classList.remove('is-hidden');
    alignProgressFill.style.width = '55%'; // no fine-grained progress signal from pose detection — same indeterminate-jump pattern as autoEnhance.js
    alignHint.textContent = 'Detecting position…';

    try {
      const usedPoseDetection = await CanvasEditor.alignAttireToPhoto();
      alignHint.textContent = usedPoseDetection
        ? 'Positioned using the photo’s detected shoulders.'
        : 'Positioned using an estimate — shoulder detection wasn’t available this time (check your connection). You can still drag/resize the attire.';
    } catch (err) {
      console.error('Align to photo failed unexpectedly:', err);
      alignHint.textContent = 'Could not align automatically — drag/resize the attire manually.';
    } finally {
      alignBtn.disabled = false;
      alignBtnText.textContent = 'Align to photo';
      alignProgress.classList.add('is-hidden');
      alignProgressFill.style.width = '0%';
    }
  }

  async function handleEnhanceAttire() {
    const attireEl = CanvasEditor.getAttireElement();
    if (!attireEl) return;

    enhanceAttireBtn.disabled = true;
    enhanceAttireBtnText.textContent = 'Enhancing…';
    enhanceAttireProgress.classList.remove('is-hidden');
    enhanceAttireHint.textContent = 'First use downloads a small AI model — needs an internet connection once, and can take a minute or more to finish setting up on this device.';

    try {
      const resultCanvas = await AttireEnhance.enhance(attireEl, (pct) => {
        enhanceAttireProgressFill.style.width = `${pct}%`;
        enhanceAttireHint.textContent = pct < 100 ? `Downloading model… ${pct}%` : 'Setting up (first time only — faster after this)…';
      });
      CanvasEditor.setAttireCustomImage(resultCanvas.toDataURL('image/png'));
      setGenderActive(null); // the enhanced result no longer matches either preset exactly
      enhanceAttireHint.textContent = 'Attire sharpened and upscaled.';
    } catch (err) {
      console.error('Attire enhance failed:', err);
      enhanceAttireHint.textContent = 'Could not enhance the attire — check your connection and try again.';
    } finally {
      enhanceAttireBtn.disabled = false;
      enhanceAttireBtnText.textContent = 'Enhance attire';
      enhanceAttireProgress.classList.add('is-hidden');
      enhanceAttireProgressFill.style.width = '0%';
    }
  }

  function wireEvents() {
    attireToggle.addEventListener('change', () => {
      const enabled = attireToggle.checked;
      attireControlsBox.classList.toggle('is-hidden', !enabled);
      CanvasEditor.setAttireEnabled(enabled);
    });

    genderToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      setGenderActive(btn.dataset.gender);
      CanvasEditor.setAttireGender(btn.dataset.gender);
    });

    alignBtn.addEventListener('click', handleAlign);
    enhanceAttireBtn.addEventListener('click', handleEnhanceAttire);

    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', (e) => {
      handleUploadFile(e.target.files[0]);
      uploadInput.value = '';
    });

    opacityRange.addEventListener('input', (e) => {
      CanvasEditor.setAttireOpacity(Number(e.target.value) / 100);
    });
    opacityRange.addEventListener('change', () => CanvasEditor.commitHistory());

    // Reset when a fresh photo is uploaded — attire choice/opacity is
    // kept (it's a styling preference), but the on/off state resets so
    // the new photo starts from its plain upload, same as bgRemoval.js.
    document.addEventListener('upload:change', () => {
      attireToggle.checked = false;
      attireControlsBox.classList.add('is-hidden');
      CanvasEditor.setAttireEnabled(false);
    });

    // "Delete" on the Attire layer (Step 2's Layers list) already turned
    // the overlay off in CanvasEditor — just mirror that in this panel's
    // own toggle so they don't disagree.
    document.addEventListener('attire:deleted', () => {
      attireToggle.checked = false;
      attireControlsBox.classList.add('is-hidden');
    });

    // Undo/redo restores CanvasEditor's internal state directly (same as
    // Recopy) without going through this panel's own controls — re-sync
    // afterward so the toggle/gender/opacity shown here match reality.
    document.addEventListener('editstate:restored', (e) => syncUI(e.detail));
  }

  /**
   * Syncs this panel's own toggles/segments to match restored state —
   * used by Save/Recopy (Step 5) after CanvasEditor.loadState() has
   * already applied the actual attire to the canvas. Purely cosmetic:
   * does not call back into CanvasEditor.
   */
  function syncUI(saved) {
    const enabled = !!(saved && saved.attireEnabled);
    attireToggle.checked = enabled;
    attireControlsBox.classList.toggle('is-hidden', !enabled);

    const sourceKey = saved && saved.attireSourceKey;
    setGenderActive(sourceKey === 'custom' ? null : (sourceKey || 'male'));

    const opacity = saved && saved.attireOpacity != null ? saved.attireOpacity : 1;
    opacityRange.value = Math.round(opacity * 100);
  }

  function init() {
    cacheDom();
    wireEvents();
  }

  return { init, syncUI };
})();
