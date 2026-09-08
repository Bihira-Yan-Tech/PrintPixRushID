/**
 * SaveRecopy module
 * Step 5: saves the entire current job (page setup, ID size/quantity/
 * name tag, print layout, and the photo edit itself) — both as a record
 * in this browser's localStorage list (for a quick in-app pick-list),
 * and, where the browser supports it, as a real standalone .json file
 * the user chooses via a native Save dialog — so a job can be carried
 * on a USB stick and opened with this exact same app on a different
 * computer and come back exactly as it was.
 *
 * File saving uses the File System Access API (`showSaveFilePicker`) —
 * Chrome/Edge only. Firefox/Safari fall back to a plain browser
 * download (still correct, just no native "pick a folder" dialog and
 * no in-place re-save without picking a location again). See
 * `supportsFileSystemAccess()`.
 *
 * A `FileSystemFileHandle` returned by that picker lets this page write
 * to the *same* file again later without re-prompting, but only for the
 * lifetime of this handle in memory (`fileHandles`, keyed by job id) —
 * handles are NOT persisted across a page reload (would need IndexedDB
 * + a permission re-grant anyway, for very little practical benefit
 * over just picking the file again). So: within one session, the list's
 * "Save" button overwrites the exact file in place; after a reload, the
 * first "Save" on a job re-prompts for a location once more.
 *
 * Unlike the other Step modules, this one doesn't own any state that
 * other modules react to — it only reads state from PageSetup / IdSize /
 * PrintExport / CanvasEditor on Save, and pushes it back into them
 * (via their setState/loadState) on Open/Import.
 *
 * Mobile-only: a bare Android WebView has no download manager, so the
 * plain-download fallback below (downloadJson) silently does nothing
 * there — an <a download> click with no DownloadListener registered is
 * a no-op. When window.AndroidBridge is present (mobile build only, see
 * MainActivity.java), saveJobToFile() routes through it instead, ahead
 * of both the File System Access API and the download fallback:
 * AndroidBridge.saveFileAs() opens Android's Storage Access Framework
 * "Save as" picker (a real folder-choice dialog, same idea as
 * showSaveFilePicker/Electron's dialog.showSaveDialog) rather than
 * writing somewhere fixed with no user choice — an earlier version of
 * this bridge wrote silently to the Downloads folder via MediaStore,
 * which real-device feedback showed didn't satisfy the actual ask (a
 * dialog letting the user pick where). The returned content:// Uri
 * string is kept as that job's "linked file" (see fileHandles below)
 * so a later Save on the same job can call AndroidBridge.writeToUri()
 * and skip the picker, mirroring the browser/Electron handle-reuse
 * behavior.
 *
 * `applyJob`, `captureCurrentJob`, `loadJobs`, and `saveCurrentJob` are
 * exported for reuse by jobLifecycle.js (the startup New Job/Open Job
 * gate + the in-workspace "Create New Job" trigger) — a "new job" is
 * just applyJob() with a hand-built blank template, so it reuses this
 * exact restore path instead of duplicating per-module reset logic.
 * applyJob() also dispatches a `job:applied` event on completion, which
 * jobLifecycle.js listens for to clear its own "unsaved changes" flag.
 *
 * Each list item's "Open" button routes through
 * `JobLifecycle.requestOpenJob(job)` rather than calling `applyJob()`
 * directly, so opening a job from here gets the same unsaved-changes
 * confirm guard as "Create New Job" — this is the direct, no-detour way
 * to load a saved job back in (the startup gate's "Open Job" picker is
 * the only other option before this was added, and only exists at boot).
 */
const SaveRecopy = (() => {

  const STORAGE_KEY = 'printpixRushId.jobs';

  // FileSystemFileHandle per job id, this browser tab/session only — see
  // the module comment above for why these don't survive a reload.
  const fileHandles = new Map();

  let labelInput, saveBtn, saveHint, jobList, jobListEmpty, storageWarning;
  let importBtn, importInput;
  let confirmSaveModal, confirmSaveText, confirmSaveCancelBtn, confirmSaveConfirmBtn;

  function cacheDom() {
    labelInput = document.getElementById('jobLabelInput');
    saveBtn = document.getElementById('saveJobBtn');
    saveHint = document.getElementById('saveJobHint');
    jobList = document.getElementById('jobList');
    jobListEmpty = document.getElementById('jobListEmpty');
    storageWarning = document.getElementById('storageWarning');
    importBtn = document.getElementById('importJobBtn');
    importInput = document.getElementById('importJobInput');

    confirmSaveModal = document.getElementById('confirmSaveJobModal');
    confirmSaveText = document.getElementById('confirmSaveJobText');
    confirmSaveCancelBtn = document.getElementById('confirmSaveJobCancelBtn');
    confirmSaveConfirmBtn = document.getElementById('confirmSaveJobConfirmBtn');
  }

  function loadJobs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('Could not read saved jobs:', err);
      return [];
    }
  }

  /**
   * Turns a raw storage exception into an explanation a non-developer
   * can act on. `QuotaExceededError` (storage genuinely full) and
   * `SecurityError` (storage blocked outright — the most common real
   * cause: the app opened directly as a `file://` page rather than
   * through a web server, which some browsers refuse to grant local
   * storage to; also happens in some strict private-browsing modes) get
   * distinct messages; anything else falls back to showing the raw
   * error name/message so it's at least reportable.
   */
  function describeStorageError(err) {
    if (!err) return 'Unknown error.';
    if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'Storage is full — delete some saved jobs below, then try saving again.';
    }
    if (err.name === 'SecurityError') {
      return 'This browser is blocking local storage for this page — common when the app is opened directly as a file (double-clicked) instead of through a web server, or in strict private-browsing mode. Try opening it via a local server instead.';
    }
    return `Could not save (${err.name || 'error'}: ${err.message || 'unknown reason'}).`;
  }

  /** True if this page can actually persist to localStorage right now. */
  function storageAvailable() {
    try {
      const testKey = '__printpixRushId_probe__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  function saveJobs(jobs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
      return { ok: true };
    } catch (err) {
      console.error('Could not save job:', err);
      return { ok: false, error: err };
    }
  }

  function captureCurrentJob(label) {
    return {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: 1,
      savedAt: new Date().toISOString(),
      label: label || `Job — ${new Date().toLocaleString()}`,
      pageSetup: PageSetup.getState(),
      idSize: IdSize.getState(),
      printLayout: PrintExport.getState(),
      photo: CanvasEditor.getSaveState(),
    };
  }

  async function applyJob(job) {
    PageSetup.setState(job.pageSetup);
    IdSize.setState(job.idSize);
    PrintExport.setState(job.printLayout);
    await CanvasEditor.loadState(job.photo);
    BgRemoval.syncUI(job.photo.background, !!job.photo.photoDataUrl);
    // Lets jobLifecycle.js know the workspace now matches a known job
    // (blank, saved, or imported) — see its own "dirty" tracking.
    document.dispatchEvent(new CustomEvent('job:applied'));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderJobList() {
    const jobs = loadJobs();
    jobList.innerHTML = '';
    jobListEmpty.classList.toggle('is-hidden', jobs.length > 0);

    jobs.slice().reverse().forEach((job) => {
      const saved = new Date(job.savedAt);
      const handle = fileHandles.get(job.id);
      const metaBits = [
        saved.toLocaleDateString() + ' · ' + saved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ];
      if (handle) metaBits.push(`linked to ${handleDisplayName(handle)}`);

      const item = document.createElement('div');
      item.className = 'job-item';
      item.dataset.id = job.id;
      item.innerHTML = `
        <div class="job-info">
          <span class="job-label">${escapeHtml(job.label)}</span>
          <span class="job-meta">${escapeHtml(metaBits.join(' · '))}</span>
        </div>
        <div class="job-actions">
          <button type="button" class="icon-btn" data-action="open" title="Open this job into the workspace">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5.5C2 4.67 2.67 4 3.5 4H6L7.2 5.5H10.5C11.33 5.5 12 6.17 12 7V9.5C12 10.33 11.33 11 10.5 11H3.5C2.67 11 2 10.33 2 9.5V5.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="icon-btn" data-action="save" title="Save current edits to this job">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 2H10L11.5 3.5V11.5C11.5 11.78 11.28 12 11 12H3C2.72 12 2.5 11.78 2.5 11.5V2.5C2.5 2.22 2.72 2 3 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 2V5.5H9V2" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><rect x="4.5" y="7.5" width="5" height="3" rx="0.4" stroke="currentColor" stroke-width="1.1"/></svg>
          </button>
          <button type="button" class="icon-btn is-danger" data-action="delete" title="Remove from this list (does not delete a saved file on disk)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 3.5H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 3.5V2.3C5 1.98 5.28 1.7 5.6 1.7H8.4C8.72 1.7 9 1.98 9 2.3V3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 3.5L4 11.5C4 12.05 4.45 12.5 5 12.5H9C9.55 12.5 10 12.05 10 11.5L10.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
      jobList.appendChild(item);
    });
  }

  function suggestFileName(label) {
    return `${(label || 'printpix-job').replace(/[^\w-]+/g, '_')}.json`;
  }

  /**
   * Fallback for browsers without the File System Access API (Firefox,
   * Safari): a plain forced download. Revoking the object URL is
   * deliberately delayed — revoking it immediately after `a.click()`
   * (the old code did this) races the browser's own download pipeline
   * in some browsers and can produce a truncated/empty file on disk,
   * since `.click()` returning doesn't mean the download has actually
   * finished reading the blob yet.
   */
  function downloadJson(job) {
    const blob = new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestFileName(job.label);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function supportsFileSystemAccess() {
    return typeof window.showSaveFilePicker === 'function';
  }

  /**
   * A "handle" remembered for a job's linked file is either a real
   * FileSystemFileHandle (browser path) or a plain `content://` Uri
   * string (Android path — AndroidBridge.saveFileAs returns a Uri, not
   * a handle object). This normalizes either into something readable
   * for hints/list metadata; Uri strings don't carry a clean filename,
   * so this is a best-effort decode of the last path segment, not a
   * guaranteed-accurate name.
   */
  function handleDisplayName(handle) {
    if (!handle) return '';
    if (typeof handle === 'string') {
      try {
        const decoded = decodeURIComponent(handle);
        const parts = decoded.split(/[\\/]/);
        return parts[parts.length - 1] || 'the chosen file';
      } catch (e) {
        return 'the chosen file';
      }
    }
    return handle.name;
  }

  /** True only inside the mobile APK's WebView — see the module comment. */
  function hasAndroidBridge() {
    return typeof window.AndroidBridge !== 'undefined' && typeof window.AndroidBridge.saveFileAs === 'function';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read the job data.'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * saveFileAs()/writeToUri() on the Java side are fire-and-forget (void)
   * because showing Android's real save-location picker is inherently
   * asynchronous — this resolves once MainActivity.java calls back via
   * a shared, idempotently-registered window.__androidSaveFileCallback.
   * Lives on `window` (not this module's own closure) because
   * printExport.js (mobile copy) uses this exact same bridge for PDF
   * export — a per-module closure would let whichever module's script
   * tag runs last silently clobber the other's callback registry.
   */
  window.__androidSaveCallbacks = window.__androidSaveCallbacks || {};
  window.__androidSaveFileCallback = window.__androidSaveFileCallback || function (requestId, result) {
    const cb = window.__androidSaveCallbacks[requestId];
    if (cb) {
      delete window.__androidSaveCallbacks[requestId];
      cb(result);
    }
  };
  function saveViaAndroidBridge(base64, filename, mimeType) {
    return new Promise((resolve) => {
      window.__androidSaveRequestSeq = (window.__androidSaveRequestSeq || 0) + 1;
      const id = String(window.__androidSaveRequestSeq);
      window.__androidSaveCallbacks[id] = resolve;
      window.AndroidBridge.saveFileAs(id, base64, filename, mimeType);
    });
  }
  function writeViaAndroidBridge(uriString, base64) {
    return new Promise((resolve) => {
      window.__androidSaveRequestSeq = (window.__androidSaveRequestSeq || 0) + 1;
      const id = String(window.__androidSaveRequestSeq);
      window.__androidSaveCallbacks[id] = resolve;
      window.AndroidBridge.writeToUri(id, uriString, base64);
    });
  }

  async function writeJobToHandle(handle, job) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(job, null, 2));
    await writable.close();
  }

  /**
   * Writes `job` to disk: reuses `existingHandle` if given (silent, no
   * dialog — the whole point of a linked handle), otherwise opens a
   * native Save dialog (Android's Storage Access Framework picker,
   * the browser's File System Access API, in that preference order) or
   * falls back to a plain download (browsers with neither). Returns
   * `{ handle, cancelled, error }` — `handle` is the (possibly new)
   * FileSystemFileHandle (browser) or `content://` Uri string (Android)
   * to remember for next time, or null if none is available.
   */
  async function saveJobToFile(job, existingHandle) {
    if (existingHandle) {
      if (typeof existingHandle === 'string') {
        const base64 = await blobToBase64(new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' }));
        const result = await writeViaAndroidBridge(existingHandle, base64);
        if (result.startsWith('ok:')) return { handle: existingHandle };
        console.error('Could not write to the linked file, falling back to a fresh save picker:', result);
        // fall through to re-picking a location below
      } else {
        try {
          await writeJobToHandle(existingHandle, job);
          return { handle: existingHandle };
        } catch (err) {
          console.error('Could not write to the linked file, falling back to a fresh save dialog:', err);
          // fall through to re-picking a location below
        }
      }
    }

    if (hasAndroidBridge()) {
      const blob = new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' });
      const base64 = await blobToBase64(blob);
      const result = await saveViaAndroidBridge(base64, suggestFileName(job.label), 'application/json');
      if (result === 'cancelled') return { cancelled: true };
      if (result.startsWith('ok:')) return { handle: result.slice(3) };
      return { error: new Error(result.replace(/^error:/, '') || 'Could not save the file on this device.') };
    }

    if (supportsFileSystemAccess()) {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: suggestFileName(job.label),
          types: [{ description: 'PrintPix Rush ID job', accept: { 'application/json': ['.json'] } }],
        });
      } catch (err) {
        if (err.name === 'AbortError') return { cancelled: true };
        return { error: err };
      }
      try {
        await writeJobToHandle(handle, job);
        return { handle };
      } catch (err) {
        return { error: err };
      }
    }

    downloadJson(job);
    return { handle: null }; // no handle to remember — this browser can't re-target a file
  }

  /**
   * Saves the current workspace as a new job record in the localStorage
   * list only (no file dialog) — the underlying piece both "Save
   * current job" (wrapped with the file dialog below) and
   * jobLifecycle.js's "Save & New" confirm action (a quick save before
   * clearing the workspace, where popping a file dialog would be
   * disruptive) need.
   */
  function saveCurrentJob(label) {
    const jobs = loadJobs();
    const job = captureCurrentJob(label);
    jobs.push(job);
    const result = saveJobs(jobs);
    if (result.ok) renderJobList();
    return { ok: result.ok, job, error: result.error };
  }

  async function handleSave() {
    const { ok, job, error } = saveCurrentJob(labelInput.value.trim());
    if (!ok) {
      saveHint.textContent = describeStorageError(error);
      return;
    }
    labelInput.value = '';

    saveBtn.disabled = true;
    try {
      const { handle, cancelled, error: fileErr } = await saveJobToFile(job, null);
      if (cancelled) {
        saveHint.textContent = `Saved "${job.label}" to the list. Use its Save button below anytime to also save it as a file.`;
      } else if (fileErr) {
        saveHint.textContent = `Saved "${job.label}" to the list, but couldn't save it as a file (${fileErr.message || fileErr.name}).`;
      } else if (handle) {
        fileHandles.set(job.id, handle);
        renderJobList();
        saveHint.textContent = `Saved "${job.label}" as ${handleDisplayName(handle)}. Move that file via USB to open it with this app on another computer.`;
      } else {
        saveHint.textContent = `Saved "${job.label}" and downloaded a copy — check your Downloads folder. (This browser doesn't support choosing a save location directly.)`;
      }
    } finally {
      saveBtn.disabled = false;
    }
  }

  function openConfirmSaveModal(text) {
    return new Promise((resolve) => {
      confirmSaveText.textContent = text;
      confirmSaveModal.classList.remove('is-hidden');

      function cleanup(result) {
        confirmSaveModal.classList.add('is-hidden');
        confirmSaveConfirmBtn.removeEventListener('click', onConfirm);
        confirmSaveCancelBtn.removeEventListener('click', onCancel);
        confirmSaveModal.removeEventListener('click', onBackdrop);
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) { if (e.target === confirmSaveModal) cleanup(false); }

      confirmSaveConfirmBtn.addEventListener('click', onConfirm);
      confirmSaveCancelBtn.addEventListener('click', onCancel);
      confirmSaveModal.addEventListener('click', onBackdrop);
    });
  }

  /**
   * The saved-jobs list's "Save" action: overwrites `job` with whatever
   * is CURRENTLY on the workspace right now (same id/label, fresh
   * savedAt) — a real "Save", not "Save As". This is why it's guarded
   * by a confirm dialog: it's easy to click Save on the wrong list
   * entry while working on something unrelated and silently clobber
   * that job's stored data.
   */
  async function handleListSave(job, btn) {
    const handle = fileHandles.get(job.id);
    const target = handle ? `the file "${handleDisplayName(handle)}"` : 'a file you choose';
    const confirmed = await openConfirmSaveModal(
      `Save the current workspace as "${job.label}"? This overwrites ${target} with whatever is on screen right now.`
    );
    if (!confirmed) return;

    btn.disabled = true;
    try {
      const updatedJob = captureCurrentJob(job.label);
      updatedJob.id = job.id; // keep identity so this replaces the entry, not duplicates it

      const jobs = loadJobs();
      const idx = jobs.findIndex(j => j.id === job.id);
      if (idx >= 0) jobs[idx] = updatedJob; else jobs.push(updatedJob);
      const result = saveJobs(jobs);
      if (!result.ok) {
        saveHint.textContent = describeStorageError(result.error);
        return;
      }

      const { handle: newHandle, cancelled, error: fileErr } = await saveJobToFile(updatedJob, handle);
      if (cancelled) {
        saveHint.textContent = `Updated "${updatedJob.label}" in the list (no file location was chosen).`;
      } else if (fileErr) {
        saveHint.textContent = `Updated "${updatedJob.label}" in the list, but couldn't save it as a file (${fileErr.message || fileErr.name}).`;
      } else if (newHandle) {
        fileHandles.set(job.id, newHandle);
        saveHint.textContent = `Saved current edits to "${updatedJob.label}" (${handleDisplayName(newHandle)}).`;
      } else {
        saveHint.textContent = `Saved current edits to "${updatedJob.label}" and downloaded a copy.`;
      }
      renderJobList();
    } finally {
      btn.disabled = false;
    }
  }

  async function handleListClick(e) {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    const item = btn.closest('.job-item');
    const jobs = loadJobs();
    const job = jobs.find(j => j.id === item.dataset.id);
    if (!job) return;

    const action = btn.dataset.action;
    if (action === 'open') {
      btn.disabled = true;
      try {
        await JobLifecycle.requestOpenJob(job);
      } finally {
        btn.disabled = false;
      }
    } else if (action === 'save') {
      await handleListSave(job, btn);
    } else if (action === 'delete') {
      fileHandles.delete(job.id);
      const result = saveJobs(jobs.filter(j => j.id !== job.id));
      if (!result.ok) saveHint.textContent = describeStorageError(result.error);
      renderJobList();
    }
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const job = JSON.parse(reader.result);
        if (!job.photo || !job.pageSetup || !job.idSize || !job.printLayout) {
          throw new Error('Missing expected job fields');
        }
        job.id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        job.savedAt = job.savedAt || new Date().toISOString();

        const jobs = loadJobs();
        jobs.push(job);
        const result = saveJobs(jobs);
        renderJobList();

        await applyJob(job);
        saveHint.textContent = result.ok
          ? `Imported "${job.label}" and loaded it into the editor.`
          : `Loaded "${job.label}" into the editor, but couldn't add it to the saved-jobs list below: ${describeStorageError(result.error)}`;
      } catch (err) {
        console.error('Import failed:', err);
        saveHint.textContent = 'Could not import that file — is it a PrintPix Rush ID job .json?';
      }
    };
    reader.readAsText(file);
  }

  function wireEvents() {
    saveBtn.addEventListener('click', handleSave);
    jobList.addEventListener('click', handleListClick);
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      handleImportFile(e.target.files[0]);
      importInput.value = '';
    });
  }

  function init() {
    cacheDom();
    wireEvents();
    renderJobList();
    // Surface storage problems immediately (e.g. the app was opened via
    // file:// directly rather than a server) instead of only discovering
    // it the moment "Save" is clicked and fails.
    if (!storageAvailable()) {
      storageWarning.textContent = describeStorageError({ name: 'SecurityError' });
      storageWarning.classList.remove('is-hidden');
      saveBtn.disabled = true;
    }
  }

  return { init, applyJob, captureCurrentJob, loadJobs, saveCurrentJob };
})();
