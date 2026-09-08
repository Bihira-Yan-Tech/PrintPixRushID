/**
 * FormalAttireCommand module
 * Wires the "Formal attire (AI)" gender toggle + "Add Formal Attire"
 * command button. Replaces the old attireControls.js entirely (manual
 * overlay illustrations, upload/opacity/align/enhance) — see
 * canvasEditor.js's module doc and CLAUDE.md. One click runs
 * AiAttireAssistant.generateFormalAttire() against whatever AI
 * provider is configured/tested, then swaps the result straight into
 * the photo via CanvasEditor.setEnhancedPhoto() (same mechanism Auto
 * Enhance uses — a same-framing pixel replacement).
 */
const FormalAttireCommand = (() => {

  let genderToggle, addBtn, addBtnText, progress, progressFill, hint;
  let gender = 'male';

  function cacheDom() {
    genderToggle = document.getElementById('attireGenderToggle');
    addBtn = document.getElementById('addFormalAttireBtn');
    addBtnText = document.getElementById('addFormalAttireBtnText');
    progress = document.getElementById('addFormalAttireProgress');
    progressFill = document.getElementById('addFormalAttireProgressFill');
    hint = document.getElementById('addFormalAttireHint');
  }

  function setGenderActive(g) {
    genderToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.gender === g));
  }

  const DEFAULT_HINT = 'Uses your configured AI providers to generate the person actually wearing formal attire, fitted to them. Add a free API key under AI Providers (top-right) first.';

  async function handleAdd() {
    const photoEl = CanvasEditor.getPhotoElement();
    if (!photoEl) return;

    addBtn.disabled = true;
    addBtnText.textContent = 'Generating…';
    progress.classList.remove('is-hidden');
    progressFill.style.width = '35%'; // no fine-grained progress signal from the AI call — same indeterminate-jump pattern as autoEnhance.js
    hint.textContent = 'Contacting your AI provider…';

    try {
      const resultImg = await AiAttireAssistant.generateFormalAttire(photoEl, gender, (status, providerLabel) => {
        progressFill.style.width = status === 'trying' ? '65%' : '35%';
        hint.textContent = status === 'trying' ? `Trying ${providerLabel}…` : `${providerLabel} didn't work, trying the next one…`;
      });
      progressFill.style.width = '100%';
      CanvasEditor.setEnhancedPhoto(resultImg);
      hint.textContent = 'Formal attire added.';
    } catch (err) {
      console.error('Add Formal Attire failed:', err);
      hint.textContent = (err && err.message) || 'Could not generate formal attire — check your AI provider settings.';
    } finally {
      addBtn.disabled = false;
      addBtnText.textContent = 'Add Formal Attire';
      progress.classList.add('is-hidden');
      progressFill.style.width = '0%';
    }
  }

  function wireEvents() {
    genderToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      gender = btn.dataset.gender;
      setGenderActive(gender);
    });

    addBtn.addEventListener('click', handleAdd);

    // Same pattern as autoEnhance.js/bgRemoval.js — enable once a photo
    // exists. Listens to BOTH events on purpose: 'upload:change' covers a
    // brand-new upload, 'job:applied' covers a restored job (autosave/
    // Open Job/Recopy/Import) — those don't fire 'upload:change' at all
    // (the original File never survives a save/reload, see
    // canvasEditor.js's Known Simplifications), which was a real
    // pre-existing bug found during testing: this button (and, before
    // this fix, Auto Enhance / Remove Background too — see those files)
    // stayed permanently disabled after "Continue where you left off" or
    // "Open Job" despite a photo clearly being loaded.
    document.addEventListener('upload:change', () => {
      addBtn.disabled = false;
      hint.textContent = DEFAULT_HINT;
    });
    document.addEventListener('job:applied', () => {
      addBtn.disabled = !CanvasEditor.getPhotoElement();
      hint.textContent = DEFAULT_HINT;
    });
  }

  function init() {
    cacheDom();
    wireEvents();
  }

  return { init };
})();
