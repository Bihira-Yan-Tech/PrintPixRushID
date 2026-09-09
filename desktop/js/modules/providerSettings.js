/**
 * ProviderSettings module
 * Wires the "AI Providers" header button to the provider-management
 * modal (#providerSettingsModal): lists configured providers, an
 * "Add provider" form, and per-provider Test/enable/delete — all
 * backed by ModelProviders' storage + real HTTP test calls. Doesn't
 * make any AI generation calls itself — that's AiAttireAssistant.
 */
const ProviderSettings = (() => {

  let modal, openBtn, closeBtn, listEl;
  let presetSelect, labelInput, keyInput, baseUrlField, baseUrlInput, addBtn;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function open() { render(); modal.classList.remove('is-hidden'); }
  function close() { modal.classList.add('is-hidden'); }

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
      ModelProviders.removeProvider(id);
      render();
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

  function handleAdd() {
    const presetId = presetSelect.value;
    const preset = ModelProviders.PROVIDER_PRESETS[presetId];
    if (preset && preset.needsKey && !keyInput.value.trim()) {
      keyInput.focus();
      return;
    }
    if (preset && preset.needsBaseUrl && !baseUrlInput.value.trim()) {
      baseUrlInput.focus();
      return;
    }
    ModelProviders.addProvider({
      presetId,
      label: labelInput.value.trim() || preset.label,
      apiKey: keyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
    });
    labelInput.value = '';
    keyInput.value = '';
    baseUrlInput.value = '';
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
    addBtn.addEventListener('click', handleAdd);
  }

  return { init };
})();
