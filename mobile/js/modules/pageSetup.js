/**
 * PageSetup module
 * Owns paper size + orientation state and the Step 1 controls.
 * Emits a "pagesetup:change" CustomEvent on document whenever the
 * effective sheet dimensions change, so other modules (canvas editor)
 * can react without being tightly coupled to this one.
 *
 * paperKey 'custom' is a special case not in PAPER_SIZES — its
 * dimensions come from state.customWidthIn/customHeightIn (the Step 1
 * width/height inputs, shown only when 'custom' is selected) instead of
 * the fixed preset table. getBaseSize() is the one place that branches
 * on this before orientation is applied.
 */
const PageSetup = (() => {

  // Base sizes stored in inches, portrait orientation (width x height).
  // "R" sizes are the standard photo-paper sizes used by PH print shops.
  const PAPER_SIZES = {
    '2r':   { label: '2R', width: 2.5, height: 3.5 },
    '3r':   { label: '3R', width: 3.5, height: 5 },
    '4r':   { label: '4R', width: 4,   height: 6 },
    '5r':   { label: '5R', width: 5,   height: 7 },
    '6r':   { label: '6R', width: 6,   height: 8 },
    '8r':   { label: '8R', width: 8,   height: 10 },
    a4:     { label: 'A4',     width: 8.27, height: 11.69 },
    letter: { label: 'Letter', width: 8.5,  height: 11 },
    legal:  { label: 'Legal',  width: 8.5,  height: 13 },
  };

  let state = {
    paperKey: '4r',
    orientation: 'portrait', // 'portrait' | 'landscape'
    customWidthIn: 4,
    customHeightIn: 6,
  };

  let paperSelect, orientationToggle, customSizeRow, customWidthInput, customHeightInput;

  function getBaseSize() {
    return state.paperKey === 'custom'
      ? { label: 'Custom', width: state.customWidthIn, height: state.customHeightIn }
      : PAPER_SIZES[state.paperKey];
  }

  function getDimensions() {
    const base = getBaseSize();
    const isPortrait = state.orientation === 'portrait';
    return {
      key: state.paperKey,
      label: base.label,
      orientation: state.orientation,
      widthIn: isPortrait ? base.width : base.height,
      heightIn: isPortrait ? base.height : base.width,
    };
  }

  function emitChange() {
    document.dispatchEvent(
      new CustomEvent('pagesetup:change', { detail: getDimensions() })
    );
  }

  /** Raw selection state, for Save/Recopy (Step 5) — distinct from getDimensions(). */
  function getState() {
    return { ...state };
  }

  function syncCustomSizeUI() {
    customSizeRow.classList.toggle('is-hidden', state.paperKey !== 'custom');
    customWidthInput.value = state.customWidthIn;
    customHeightInput.value = state.customHeightIn;
  }

  /** Restores a saved selection and syncs the Step 1 controls to match. */
  function setState(saved) {
    state = {
      paperKey: saved.paperKey,
      orientation: saved.orientation,
      customWidthIn: saved.customWidthIn != null ? saved.customWidthIn : state.customWidthIn,
      customHeightIn: saved.customHeightIn != null ? saved.customHeightIn : state.customHeightIn,
    };
    paperSelect.value = state.paperKey;
    orientationToggle.querySelectorAll('.seg-btn').forEach(b =>
      b.classList.toggle('is-active', b.dataset.orientation === state.orientation)
    );
    syncCustomSizeUI();
    emitChange();
  }

  function init() {
    paperSelect = document.getElementById('paperSize');
    orientationToggle = document.getElementById('orientationToggle');
    customSizeRow = document.getElementById('paperCustomSizeRow');
    customWidthInput = document.getElementById('paperCustomWidthInput');
    customHeightInput = document.getElementById('paperCustomHeightInput');

    paperSelect.addEventListener('change', (e) => {
      state.paperKey = e.target.value;
      syncCustomSizeUI();
      emitChange();
    });

    customWidthInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (!isFinite(val) || val <= 0) return;
      state.customWidthIn = val;
      emitChange();
    });
    customHeightInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (!isFinite(val) || val <= 0) return;
      state.customHeightIn = val;
      emitChange();
    });

    orientationToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      state.orientation = btn.dataset.orientation;
      orientationToggle.querySelectorAll('.seg-btn').forEach(b =>
        b.classList.toggle('is-active', b === btn)
      );
      emitChange();
    });

    // Initial paint so listeners set up after us still get a first value.
    emitChange();
  }

  return { init, getDimensions, getState, setState, PAPER_SIZES };
})();
