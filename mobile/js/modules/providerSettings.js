/**
 * ProviderSettings module
 * Wires the "AI Providers" header button to the provider-management
 * modal (#providerSettingsModal): lists configured providers, an
 * "Add provider" form (also doubles as the Edit form — see
 * editingId below), and per-provider Edit/Test/enable/delete — all
 * backed by ModelProviders' storage + real HTTP test calls. Doesn't
 * make any AI generation calls itself — that's AiAttireAssistant.
 *
 * Real gap found via user report ("hirap mag-edit ang models" — hard to
 * edit providers): there used to be NO way to fix a typo'd API key or
 * change a provider's label/Base URL once added — only Test/enable/
 * Delete existed, so "editing" meant delete-then-re-add-from-scratch.
 * `editingId` (below) tracks which provider (if any) the Add-provider
 * form is currently editing instead of creating — clicking a row's new
 * Edit button loads that provider's current values into the same form
 * fields, "Add provider" relabels to "Save changes", and submitting
 * calls `ModelProviders.updateProvider()` instead of `addProvider()`.
 * Changing the key/Base URL/preset invalidates any previous test result
 * (the old model list/pass-fail no longer means anything for a
 * different key), so a save resets `lastTestStatus` back to untested —
 * same as a freshly-added provider — rather than keeping a stale
 * "Working" badge that's no longer actually verified.
 */
const ProviderSettings = (() => {

  let modal, openBtn, closeBtn, listEl;
  let presetSelect, labelInput, keyInput, baseUrlField, baseUrlInput, addBtn, cancelEditBtn, formTitle;

  let editingId = null; // provider config id currently being edited, or null when adding new

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function open() { render(); modal.classList.remove('is-hidden'); }
  function close() { cancelEdit(); modal.classList.add('is-hidden'); }

  function statusBadge(config) {
    if (config.lastTestStatus === 'ok') return `<span class="mono-label" style="color:#16A34A;">✓ Working (${config.models.length} model${config.models.length === 1 ? '' : 's'})</span>`;
    if (config.lastTestStatus === 'error') return `<span class="mono-label" style="color:#DC2626;">✗ ${escapeHtml(config.lastTestError || 'Test failed')}</span>`;
    return `<span class="mono-label">Not tested yet</span>`;
  }

  function render() {
    const configs = ModelProviders.loadConfigs();
    listEl.innerHTML = '';
    if (!configs.length) {
      listEl.innerHTML = `<p class="hint-text is-compact">No providers added yet.</p>`;
      return;
    }

    configs.forEach((config) => {
      const preset = ModelProviders.PROVIDER_PRESETS[config.presetId] || ModelProviders.PROVIDER_PRESETS.custom;
      const item = document.createElement('div');
      item.className = 'job-item';
      item.dataset.id = config.id;
      item.innerHTML = `
        <div class="job-info">
          <span class="job-label">${escapeHtml(config.label)}${preset.supportsImageEdit === false ? ' <span class="hint-text is-compact" style="display:inline;">(no image editing)</span>' : ''}</span>
          <span class="job-meta">${escapeHtml(preset.label)}${config.baseUrl ? ' · ' + escapeHtml(config.baseUrl) : ''} — ${statusBadge(config)}</span>
        </div>
        <div class="job-actions">
          <label class="switch" title="Enabled">
            <input type="checkbox" data-action="toggle" ${config.enabled ? 'checked' : ''} />
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </label>
          <button type="button" class="icon-btn" data-action="edit" title="Edit this provider">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.3L11.7 4.5L4.7 11.5L2 12L2.5 9.3L9.5 2.3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="btn-outline is-compact" data-action="test">Test</button>
          <button type="button" class="icon-btn is-danger" data-action="delete" title="Remove this provider">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 3.5H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 3.5V2.3C5 1.98 5.28 1.7 5.6 1.7H8.4C8.72 1.7 9 1.98 9 2.3V3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 3.5L4 11.5C4 12.05 4.45 12.5 5 12.5H9C9.55 12.5 10 12.05 10 11.5L10.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
      listEl.appendChild(item);
    });
  }

  async function handleListClick(e) {
    const item = e.target.closest('.job-item');
    if (!item) return;
    const id = item.dataset.id;
    const action = e.target.closest('[data-action]') && e.target.closest('[data-action]').dataset.action;

    if (action === 'delete') {
      if (editingId === id) cancelEdit(); // the entry being edited no longer exists
      ModelProviders.removeProvider(id);
      render();
    } else if (action === 'edit') {
      startEdit(id);
    } else if (action === 'test') {
      const btn = e.target.closest('button');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Testing…';
      const config = ModelProviders.loadConfigs().find(c => c.id === id);
      await ModelProviders.testProvider(config);
      btn.disabled = false;
      btn.textContent = original;
      render();
    }
  }

  /**
   * Loads an existing provider's current values into the same Add-
   * provider form fields, switching it into "edit" mode — see the
   * module doc comment for why this exists. The API key input starts
   * empty rather than showing the stored key back (the field is
   * type="password" and there's no reason to round-trip a secret
   * through the DOM just to redisplay it) — leaving it blank on save
   * keeps the existing key; typing a new one replaces it.
   */
  function startEdit(id) {
    const config = ModelProviders.loadConfigs().find(c => c.id === id);
    if (!config) return;
    editingId = id;
    presetSelect.value = config.presetId;
    onPresetChange();
    labelInput.value = config.label || '';
    keyInput.value = '';
    keyInput.placeholder = 'Leave blank to keep the current key';
    baseUrlInput.value = config.baseUrl || '';
    formTitle.textContent = `Editing "${config.label}"`;
    addBtn.textContent = 'Save changes';
    cancelEditBtn.classList.remove('is-hidden');
    labelInput.focus();
  }

  function cancelEdit() {
    editingId = null;
    labelInput.value = '';
    keyInput.value = '';
    keyInput.placeholder = 'Paste your key here (not needed for Pollinations)';
    baseUrlInput.value = '';
    formTitle.textContent = 'Add a new provider';
    addBtn.textContent = 'Add provider';
    cancelEditBtn.classList.add('is-hidden');
  }

  function handleListChange(e) {
    if (e.target.dataset.action !== 'toggle') return;
    const item = e.target.closest('.job-item');
    ModelProviders.updateProvider(item.dataset.id, { enabled: e.target.checked });
  }

  function onPresetChange() {
    const preset = ModelProviders.PROVIDER_PRESETS[presetSelect.value];
    keyInput.parentElement.classList.toggle('is-hidden', !(preset && preset.needsKey));
    baseUrlField.classList.toggle('is-hidden', !(preset && preset.needsBaseUrl));
  }

  function handleSubmit() {
    const presetId = presetSelect.value;
    const preset = ModelProviders.PROVIDER_PRESETS[presetId];
    // A blank key is only invalid when adding new or switching to a
    // preset that needs one — during an edit it legitimately means
    // "keep the key already saved", see startEdit()'s comment.
    if (preset && preset.needsKey && !keyInput.value.trim() && !editingId) {
      keyInput.focus();
      return;
    }
    if (preset && preset.needsBaseUrl && !baseUrlInput.value.trim()) {
      baseUrlInput.focus();
      return;
    }

    if (editingId) {
      const existing = ModelProviders.loadConfigs().find(c => c.id === editingId);
      const patch = {
        presetId,
        label: labelInput.value.trim() || preset.label,
        baseUrl: baseUrlInput.value.trim(),
      };
      if (keyInput.value.trim()) patch.apiKey = keyInput.value.trim();
      // Changing preset/key/baseUrl makes any previous test result
      // meaningless (it verified a different config) — reset to
      // untested so the UI never shows a stale "Working" badge for a
      // setup that hasn't actually been re-verified, same treatment a
      // brand-new provider gets.
      const configChanged = !existing || existing.presetId !== patch.presetId
        || patch.baseUrl !== (existing.baseUrl || '')
        || (patch.apiKey !== undefined && patch.apiKey !== existing.apiKey);
      if (configChanged) {
        patch.models = [];
        patch.lastTestStatus = null;
        patch.lastTestError = null;
        patch.lastTestedAt = null;
      }
      ModelProviders.updateProvider(editingId, patch);
      cancelEdit();
    } else {
      ModelProviders.addProvider({
        presetId,
        label: labelInput.value.trim() || preset.label,
        apiKey: keyInput.value.trim(),
        baseUrl: baseUrlInput.value.trim(),
      });
      labelInput.value = '';
      keyInput.value = '';
      baseUrlInput.value = '';
    }
    render();
  }

  function init() {
    modal = document.getElementById('providerSettingsModal');
    openBtn = document.getElementById('providerSettingsBtn');
    closeBtn = document.getElementById('providerSettingsCloseBtn');
    listEl = document.getElementById('providerList');
    presetSelect = document.getElementById('providerPresetSelect');
    labelInput = document.getElementById('providerLabelInput');
    keyInput = document.getElementById('providerKeyInput');
    baseUrlField = document.getElementById('providerBaseUrlField');
    baseUrlInput = document.getElementById('providerBaseUrlInput');
    addBtn = document.getElementById('providerAddBtn');
    cancelEditBtn = document.getElementById('providerCancelEditBtn');
    formTitle = document.getElementById('providerFormTitle');

    // Populated once, here, not in render() — PROVIDER_PRESETS is a
    // static list that never changes at runtime. render() used to
    // rebuild this on every list update (delete/test), which silently
    // reset the Add-provider form's dropdown back to the first preset
    // (and re-ran onPresetChange()'s show/hide) any time the user
    // clicked Test/Delete on an already-listed provider — a real bug:
    // it could discard an in-progress preset selection while the
    // already-typed key/baseURL text stayed behind in now-mismatched
    // (possibly hidden) fields, ready to be silently submitted under
    // the wrong preset if the user then clicked "Add provider".
    presetSelect.innerHTML = Object.values(ModelProviders.PROVIDER_PRESETS)
      .map(p => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
    onPresetChange();

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    listEl.addEventListener('click', handleListClick);
    listEl.addEventListener('change', handleListChange);
    presetSelect.addEventListener('change', onPresetChange);
    // Best-effort auto-detect: pasting/typing a recognizable key format
    // pre-selects the matching provider in the dropdown so the user
    // doesn't have to hunt for it manually — still fully overridable,
    // see ModelProviders.detectPresetFromKey()'s own doc comment.
    keyInput.addEventListener('input', () => {
      const detected = ModelProviders.detectPresetFromKey(keyInput.value);
      if (detected && presetSelect.value !== detected) {
        presetSelect.value = detected;
        onPresetChange();
      }
    });
    addBtn.addEventListener('click', handleSubmit);
    cancelEditBtn.addEventListener('click', cancelEdit);
  }

  return { init };
})();
