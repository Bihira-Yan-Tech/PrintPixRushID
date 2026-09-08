/**
 * JobLifecycle module
 * Owns two things:
 *
 * 1. The startup gate — a modal shown the moment the app loads, before
 *    any step panel is usable, offering "New Job" (start blank) or
 *    "Open Job" (load a saved job, reusing Step 5's saved-jobs list).
 * 2. The "Create New Job" trigger that stays visible in the header once
 *    inside the workspace — clicking it clears everything back to blank,
 *    but first warns (and offers to save) if there are unsaved changes.
 *    The same unsaved-changes confirm modal is reused by
 *    requestOpenJob() below for Step 5's own "Open" button on a saved
 *    job — same "are you sure" shape, just different wording/action
 *    afterward, so one modal (with a couple of text nodes swapped by id)
 *    covers both instead of duplicating it.
 *
 * "Blank" is a hand-built job template (BLANK_JOB below), not a live
 * capture of each module's state at boot. The values mirror each
 * module's own hardcoded defaults (PageSetup's '4r'/portrait, IdSize's
 * empty entries list, PrintExport's 0.2in margin, etc.) — if those
 * defaults ever change, update BLANK_JOB to match.
 *
 * Applying "New"/"Open" reuses SaveRecopy.applyJob() — the exact same
 * restore path Recopy/Import already use — rather than teaching every
 * module its own separate "reset" method.
 *
 * "Unsaved changes" is a conservative dirty flag, not a real diff: any
 * `pagesetup:change` / `photo:change` / `upload:change` / `idsize:change`
 * / `printlayout:change` sets it, and only a `job:applied` event (fired
 * by SaveRecopy.applyJob at the end of New/Open/Recopy/Import) clears
 * it. Undoing back to an unchanged state still shows as "unsaved" —
 * same trade-off most editors make, not worth a deep-equality check here.
 *
 * 3. Autosave/crash-recovery — the same dirty-tracking events also
 *    debounce-write a full job snapshot to `localStorage` under
 *    `AUTOSAVE_KEY` (separate from the named Save Job list). Fixes
 *    losing work on an accidental page refresh (no prior explicit
 *    "Save" needed), and doubles as a safety net for the Android
 *    build's WebView getting recreated (e.g. if Android reclaims
 *    memory) even though `AndroidManifest.xml` already declares
 *    `configChanges` for the config axes that would otherwise trigger
 *    that. The draft is read once at boot (`pendingAutosaveDraft`,
 *    captured before any write could touch it) and offered as
 *    "Continue where you left off" on the startup gate if it has an
 *    actual photo in it; picking any of New/Open/Continue re-applies
 *    and the debounced writer naturally overwrites the draft to match
 *    afterward (no separate clear-on-New-Job step needed).
 */
const JobLifecycle = (() => {

  const BLANK_JOB = {
    pageSetup: { paperKey: '4r', orientation: 'portrait' },
    idSize: {
      entries: [],
      nameTag: { enabled: false, text: 'Juan Dela Cruz', color: '#16A34A' },
    },
    printLayout: {
      marginIn: 0.2,
      watermark: { enabled: false, text: 'PROOF' },
      showCuttingGuide: true,
      tightPacking: false,
    },
    photo: {
      photoDataUrl: null,
      photoTransform: null,
      background: { mode: 'none', color: '#FFFFFF', imageDataUrl: null },
    },
  };

  const AUTOSAVE_KEY = 'printpixRushId.autosave';
  const AUTOSAVE_DEBOUNCE_MS = 800;

  let dirty = false;
  let autosaveTimer = null;
  let pendingAutosaveDraft = null; // captured once at boot, before any write can touch it

  let gateModal, gateChoiceView, gatePickerView;
  let gateContinueBtn, gateNewBtn, gateOpenBtn, gateBackBtn, gateJobList, gateJobListEmpty;

  let headerNewJobBtn;

  let confirmModal, confirmTitle, confirmBodyText, confirmLabelInput, confirmHint;
  let confirmCancelBtn, confirmDiscardBtn, confirmSaveBtn;

  // What Discard/Save & ... should do when the confirm modal is currently
  // open — set by handleCreateNewJobClick (kind: 'new') or requestOpenJob
  // (kind: 'open', with the target job). Cleared once acted on.
  let pendingConfirm = null;

  function cacheDom() {
    gateModal = document.getElementById('startupGateModal');
    gateChoiceView = document.getElementById('startupChoiceView');
    gatePickerView = document.getElementById('startupPickerView');
    gateContinueBtn = document.getElementById('startupContinueBtn');
    gateNewBtn = document.getElementById('startupNewJobBtn');
    gateOpenBtn = document.getElementById('startupOpenJobBtn');
    gateBackBtn = document.getElementById('startupBackBtn');
    gateJobList = document.getElementById('startupJobList');
    gateJobListEmpty = document.getElementById('startupJobListEmpty');

    headerNewJobBtn = document.getElementById('newJobBtn');

    confirmModal = document.getElementById('confirmNewJobModal');
    confirmTitle = document.getElementById('confirmNewJobTitle');
    confirmBodyText = document.getElementById('confirmNewJobBodyText');
    confirmLabelInput = document.getElementById('confirmNewJobLabelInput');
    confirmHint = document.getElementById('confirmNewJobHint');
    confirmCancelBtn = document.getElementById('confirmNewJobCancelBtn');
    confirmDiscardBtn = document.getElementById('confirmNewJobDiscardBtn');
    confirmSaveBtn = document.getElementById('confirmNewJobSaveBtn');
  }

  function markDirty() {
    dirty = true;
    scheduleAutosave();
  }
  function markClean() { dirty = false; }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        const job = SaveRecopy.captureCurrentJob('__autosave__');
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(job));
      } catch (err) {
        console.error('Autosave failed (not user-facing — Save Job still works normally):', err);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function loadAutosaveDraft() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      const job = raw ? JSON.parse(raw) : null;
      // Only worth offering if there's an actual photo — a draft with
      // just default page-setup/margin tweaks isn't "work" to recover.
      return job && job.photo && job.photo.photoDataUrl ? job : null;
    } catch (err) {
      return null;
    }
  }

  async function goNewJob() {
    await SaveRecopy.applyJob(JSON.parse(JSON.stringify(BLANK_JOB)));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderGateJobList() {
    const jobs = SaveRecopy.loadJobs();
    gateJobList.innerHTML = '';
    gateJobListEmpty.classList.toggle('is-hidden', jobs.length > 0);

    jobs.slice().reverse().forEach((job) => {
      const saved = new Date(job.savedAt);
      const item = document.createElement('div');
      item.className = 'job-item';
      item.dataset.id = job.id;
      item.innerHTML = `
        <div class="job-info">
          <span class="job-label">${escapeHtml(job.label)}</span>
          <span class="job-meta">${saved.toLocaleDateString()} · ${saved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="job-actions">
          <button type="button" class="icon-btn" data-action="open" title="Open this job">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5.5C2 4.67 2.67 4 3.5 4H6L7.2 5.5H10.5C11.33 5.5 12 6.17 12 7V9.5C12 10.33 11.33 11 10.5 11H3.5C2.67 11 2 10.33 2 9.5V5.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
      gateJobList.appendChild(item);
    });
  }

  function showGateChoice() {
    gateChoiceView.classList.remove('is-hidden');
    gatePickerView.classList.add('is-hidden');

    const hasDraft = !!pendingAutosaveDraft;
    gateContinueBtn.classList.toggle('is-hidden', !hasDraft);
    // Continue (when offered) is the more likely wanted action — give
    // it the primary styling and demote New Job to outline, matching
    // how Open Job is already styled.
    gateNewBtn.classList.toggle('btn-primary', !hasDraft);
    gateNewBtn.classList.toggle('btn-outline', hasDraft);
  }

  function showGatePicker() {
    renderGateJobList();
    gateChoiceView.classList.add('is-hidden');
    gatePickerView.classList.remove('is-hidden');
  }

  function closeGate() {
    gateModal.classList.add('is-hidden');
  }

  async function handleGateNewJob() {
    gateNewBtn.disabled = true;
    try {
      await goNewJob();
      closeGate();
    } finally {
      gateNewBtn.disabled = false;
    }
  }

  async function handleGateContinue() {
    if (!pendingAutosaveDraft) return;
    gateContinueBtn.disabled = true;
    try {
      await SaveRecopy.applyJob(pendingAutosaveDraft);
      closeGate();
    } finally {
      gateContinueBtn.disabled = false;
    }
  }

  async function handleGateJobListClick(e) {
    const btn = e.target.closest('.icon-btn[data-action="open"]');
    if (!btn) return;
    const item = btn.closest('.job-item');
    const job = SaveRecopy.loadJobs().find(j => j.id === item.dataset.id);
    if (!job) return;

    btn.disabled = true;
    try {
      await SaveRecopy.applyJob(job);
      closeGate();
    } finally {
      btn.disabled = false;
    }
  }

  function openConfirmModal(kind, targetJob) {
    pendingConfirm = kind === 'open' ? { kind: 'open', job: targetJob } : { kind: 'new' };
    if (kind === 'open') {
      confirmTitle.textContent = 'Open this job?';
      confirmBodyText.textContent = 'This workspace has unsaved changes — opening another job replaces them unless you save first.';
      confirmSaveBtn.textContent = 'Save & Open';
    } else {
      confirmTitle.textContent = 'Start a new job?';
      confirmBodyText.textContent = 'This workspace has unsaved changes — starting a new job clears them unless you save first.';
      confirmSaveBtn.textContent = 'Save & New';
    }
    confirmLabelInput.value = '';
    confirmHint.textContent = '';
    confirmModal.classList.remove('is-hidden');
  }

  function closeConfirmModal() {
    confirmModal.classList.add('is-hidden');
  }

  async function runPendingAction() {
    const pending = pendingConfirm;
    closeConfirmModal();
    pendingConfirm = null;
    if (pending && pending.kind === 'open') {
      await SaveRecopy.applyJob(pending.job);
    } else {
      await goNewJob();
    }
  }

  async function handleCreateNewJobClick() {
    if (!dirty) {
      await goNewJob();
      return;
    }
    openConfirmModal('new');
  }

  /**
   * Step 5's "Open" button on a saved job routes through here rather
   * than calling SaveRecopy.applyJob() directly, so opening a job gets
   * the same unsaved-changes guard "Create New Job" already has —
   * otherwise clicking Open while mid-edit on something unrelated would
   * silently discard it.
   */
  async function requestOpenJob(job) {
    if (!dirty) {
      await SaveRecopy.applyJob(job);
      return;
    }
    openConfirmModal('open', job);
  }

  async function handleConfirmDiscard() {
    await runPendingAction();
  }

  async function handleConfirmSaveAndNew() {
    const { ok, job } = SaveRecopy.saveCurrentJob(confirmLabelInput.value.trim());
    if (!ok) {
      confirmHint.textContent = 'Could not save — storage may be full or blocked (private browsing). Try Discard instead, or free up space in Step 5.';
      return;
    }
    await runPendingAction();
    // Not strictly needed (applyJob already fires job:applied, which
    // clears dirty), but confirms to the user their save landed.
    void job;
  }

  function wireDirtyTracking() {
    document.addEventListener('pagesetup:change', markDirty);
    document.addEventListener('photo:change', markDirty);
    document.addEventListener('upload:change', markDirty);
    document.addEventListener('idsize:change', markDirty);
    document.addEventListener('printlayout:change', markDirty);
    // Fired by SaveRecopy.applyJob() at the end of New/Open/Recopy/Import
    // — the workspace now matches a known job, so nothing is "unsaved".
    document.addEventListener('job:applied', markClean);
  }

  function wireEvents() {
    gateContinueBtn.addEventListener('click', handleGateContinue);
    gateNewBtn.addEventListener('click', handleGateNewJob);
    gateOpenBtn.addEventListener('click', showGatePicker);
    gateBackBtn.addEventListener('click', showGateChoice);
    gateJobList.addEventListener('click', handleGateJobListClick);

    headerNewJobBtn.addEventListener('click', handleCreateNewJobClick);

    confirmCancelBtn.addEventListener('click', closeConfirmModal);
    confirmDiscardBtn.addEventListener('click', handleConfirmDiscard);
    confirmSaveBtn.addEventListener('click', handleConfirmSaveAndNew);
  }

  function init() {
    cacheDom();
    // Captured synchronously, before wireDirtyTracking()'s listeners or
    // any module's own init() can fire a debounced autosave write that
    // would overwrite this with blank state — see the module comment.
    pendingAutosaveDraft = loadAutosaveDraft();
    wireEvents();
    wireDirtyTracking();
    showGateChoice();
    // The gate overlay starts visible (no .is-hidden in the HTML) so
    // there's no flash of the workspace before the user chooses.
  }

  return { init, requestOpenJob };
})();
