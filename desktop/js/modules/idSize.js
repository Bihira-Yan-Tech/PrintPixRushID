/**
 * IdSize module
 * Owns Step 3 state: a *list* of ID sizes added to the sheet (each with
 * its own quantity), plus the optional name-tag overlay. Emits an
 * "idsize:change" CustomEvent on document, same pattern as pageSetup.js's
 * "pagesetup:change", so LivePreview can react without being coupled to
 * this module's internals.
 *
 * The size-grid + quantity input are just a *picker* — nothing reaches
 * the sheet (or fires idsize:change with a new entry) until "Add to
 * sheet" is clicked. That's deliberate: mixing sizes only works if
 * picking a different size doesn't wipe out the one you already added.
 *
 * Quantity is still a single-sheet simplification: LivePreview packs as
 * many cells as fit (across every added size) and only draws a photo
 * into that many — requested copies beyond what fits on one sheet are
 * simply not shown, same honesty as before, just generalized to
 * multiple sizes at once.
 */
const IdSize = (() => {

  const STANDARD_SIZES = {
    '1x1':     { label: '1×1 in',     widthIn: 1,    heightIn: 1 },
    '2x2':     { label: '2×2 in',     widthIn: 2,    heightIn: 2 },
    '1.5x1.5': { label: '1.5×1.5 in', widthIn: 1.5,  heightIn: 1.5 },
    passport:  { label: 'Passport (35×45mm)', widthIn: 1.38, heightIn: 1.77 },
  };

  let pickerSizeKey = '2x2';
  let pickerCustomWidthIn = 2;
  let pickerCustomHeightIn = 2;
  let pickerQuantity = 4;

  let entries = []; // [{ id, widthIn, heightIn, quantity, label }], in the order added
  let nameTag = { enabled: false, text: 'Juan Dela Cruz', color: '#16A34A' };

  let sizeGrid, customRow, customWidthInput, customHeightInput, quantityInput,
      addSizeBtn, sizeEntryList, sizeEntryListEmpty,
      nameTagToggle, nameTagControls, nameTagTextInput, nameTagColorInput;

  function cacheDom() {
    sizeGrid = document.getElementById('sizeGrid');
    customRow = document.getElementById('customSizeRow');
    customWidthInput = document.getElementById('customWidthInput');
    customHeightInput = document.getElementById('customHeightInput');
    quantityInput = document.getElementById('quantityInput');
    addSizeBtn = document.getElementById('addSizeBtn');
    sizeEntryList = document.getElementById('sizeEntryList');
    sizeEntryListEmpty = document.getElementById('sizeEntryListEmpty');
    nameTagToggle = document.getElementById('nameTagToggle');
    nameTagControls = document.getElementById('nameTagControls');
    nameTagTextInput = document.getElementById('nameTagTextInput');
    nameTagColorInput = document.getElementById('nameTagColorInput');
  }

  function getPickerDimensions() {
    if (pickerSizeKey === 'custom') {
      return { widthIn: pickerCustomWidthIn, heightIn: pickerCustomHeightIn };
    }
    const preset = STANDARD_SIZES[pickerSizeKey];
    return { widthIn: preset.widthIn, heightIn: preset.heightIn };
  }

  function labelForDims(widthIn, heightIn) {
    for (const key in STANDARD_SIZES) {
      const p = STANDARD_SIZES[key];
      if (Math.abs(p.widthIn - widthIn) < 0.005 && Math.abs(p.heightIn - heightIn) < 0.005) return p.label;
    }
    return `${widthIn.toFixed(2)}×${heightIn.toFixed(2)} in`;
  }

  function emitChange() {
    document.dispatchEvent(new CustomEvent('idsize:change', {
      detail: {
        entries: entries.map(e => ({ widthIn: e.widthIn, heightIn: e.heightIn, quantity: e.quantity })),
        nameTag: { ...nameTag },
      },
    }));
  }

  function selectPickerSize(key) {
    pickerSizeKey = key;
    sizeGrid.querySelectorAll('.size-btn').forEach(b =>
      b.classList.toggle('is-active', b.dataset.size === key)
    );
    customRow.classList.toggle('is-hidden', key !== 'custom');
  }

  function renderEntryList() {
    sizeEntryList.innerHTML = '';
    sizeEntryListEmpty.classList.toggle('is-hidden', entries.length > 0);

    entries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'job-item';
      item.dataset.id = entry.id;
      item.innerHTML = `
        <div class="job-info">
          <span class="job-label">${entry.label}</span>
          <span class="job-meta">Qty ${entry.quantity}</span>
        </div>
        <div class="job-actions">
          <button type="button" class="icon-btn is-danger" data-action="remove" title="Remove">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 3.5H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 3.5V2.3C5 1.98 5.28 1.7 5.6 1.7H8.4C8.72 1.7 9 1.98 9 2.3V3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 3.5L4 11.5C4 12.05 4.45 12.5 5 12.5H9C9.55 12.5 10 12.05 10 11.5L10.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
      sizeEntryList.appendChild(item);
    });
  }

  function addEntry() {
    const dims = getPickerDimensions();
    if (!(dims.widthIn > 0) || !(dims.heightIn > 0)) return;
    entries.push({
      id: `size-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      widthIn: dims.widthIn,
      heightIn: dims.heightIn,
      quantity: pickerQuantity,
      label: labelForDims(dims.widthIn, dims.heightIn),
    });
    renderEntryList();
    emitChange();
  }

  function removeEntry(id) {
    entries = entries.filter(e => e.id !== id);
    renderEntryList();
    emitChange();
  }

  /** Raw state, for Save/Recopy (Step 5). */
  function getState() {
    return {
      entries: entries.map(e => ({ ...e })),
      pickerSizeKey, pickerCustomWidthIn, pickerCustomHeightIn, pickerQuantity,
      nameTag: { ...nameTag },
    };
  }

  /** Restores a saved list of entries + picker/name-tag state, and syncs the Step 3 controls. */
  function setState(saved) {
    entries = (saved.entries || []).map(e => ({ ...e }));
    pickerSizeKey = saved.pickerSizeKey || '2x2';
    pickerCustomWidthIn = saved.pickerCustomWidthIn || 2;
    pickerCustomHeightIn = saved.pickerCustomHeightIn || 2;
    pickerQuantity = saved.pickerQuantity || 4;
    nameTag = { enabled: false, text: 'Juan Dela Cruz', color: '#16A34A', ...saved.nameTag };

    selectPickerSize(pickerSizeKey);
    customWidthInput.value = pickerCustomWidthIn;
    customHeightInput.value = pickerCustomHeightIn;
    quantityInput.value = pickerQuantity;
    renderEntryList();

    nameTagToggle.checked = nameTag.enabled;
    nameTagControls.classList.toggle('is-hidden', !nameTag.enabled);
    nameTagTextInput.value = nameTag.text;
    nameTagColorInput.value = nameTag.color;

    emitChange();
  }

  function init() {
    cacheDom();

    sizeGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.size-btn');
      if (!btn) return;
      selectPickerSize(btn.dataset.size);
    });

    customWidthInput.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v) && v > 0) pickerCustomWidthIn = v;
    });

    customHeightInput.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v) && v > 0) pickerCustomHeightIn = v;
    });

    quantityInput.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v) && v > 0) pickerQuantity = v;
    });

    addSizeBtn.addEventListener('click', addEntry);

    sizeEntryList.addEventListener('click', (e) => {
      const btn = e.target.closest('.icon-btn[data-action="remove"]');
      if (!btn) return;
      removeEntry(btn.closest('.job-item').dataset.id);
    });

    nameTagToggle.addEventListener('change', (e) => {
      nameTag.enabled = e.target.checked;
      nameTagControls.classList.toggle('is-hidden', !e.target.checked);
      emitChange();
    });

    nameTagTextInput.addEventListener('input', (e) => {
      nameTag.text = e.target.value;
      emitChange();
    });

    nameTagColorInput.addEventListener('input', (e) => {
      nameTag.color = e.target.value;
      emitChange();
    });

    selectPickerSize(pickerSizeKey);
    renderEntryList();

    // Initial paint (empty entries) so LivePreview still gets a first value.
    emitChange();
  }

  return { init, getState, setState, STANDARD_SIZES };
})();
