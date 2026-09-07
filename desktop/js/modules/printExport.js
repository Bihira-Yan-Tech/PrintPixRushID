/**
 * PrintExport module
 * Owns Step 4 state: sheet margin, cutting-guide visibility, tight
 * packing (no gap between cells), and the watermark/proofing overlay.
 * Emits "printlayout:change" on document whenever any of these change,
 * same pattern as "idsize:change".
 *
 * "Print" and "Export PDF" both open a shared Print Preview modal first
 * (rendered via LivePreview.renderToCanvas() at 300 PPI, so what you see
 * is exactly what prints/exports) — the modal itself offers both actions,
 * regardless of which button opened it.
 *
 * PDF export embeds the raster into a single-page PDF sized to the
 * current sheet via jsPDF, loaded on demand from `vendor/` (self-hosted,
 * not a CDN — this is one of the two dependencies made fully offline;
 * see CLAUDE.md). Still lazy-loaded on first export rather than eagerly,
 * same "don't pay for it until you use it" reasoning as before, just
 * from a local file now instead of a network fetch.
 *
 * Printing goes through a hidden same-origin iframe holding just the
 * rendered image, with an injected @page CSS rule matching the physical
 * sheet size — this is what keeps Chrome/Edge from silently "fit to
 * page" scaling the print, which would throw off the exact physical
 * size an ID photo needs. Firefox/Safari don't honor @page sizing the
 * same way; the "print at actual size" hint in the modal is the
 * fallback there (set the printer's paper size manually).
 *
 * The exported photo quality is capped by whatever resolution the
 * uploaded source photo actually has; rendering at 300 PPI does not
 * invent detail beyond that.
 */
const PrintExport = (() => {

  const EXPORT_PPI = 300;

  let marginInput, watermarkToggle, watermarkControls, watermarkTextInput;
  let cuttingGuideToggle, tightPackingToggle;
  let exportBtn, printBtn;
  let modal, modalImg, modalSizeText, modalActualSizeToggle, modalHint;
  let modalDownloadBtn, modalPrintBtn, modalCloseBtn;

  let state = {
    marginIn: 0.2,
    watermark: { enabled: false, text: 'PROOF' },
    showCuttingGuide: true,
    tightPacking: false,
  };

  let jsPDFCtor = null; // cached after the first dynamic import

  function cacheDom() {
    marginInput = document.getElementById('marginInput');
    watermarkToggle = document.getElementById('watermarkToggle');
    watermarkControls = document.getElementById('watermarkControls');
    watermarkTextInput = document.getElementById('watermarkTextInput');
    cuttingGuideToggle = document.getElementById('cuttingGuideToggle');
    tightPackingToggle = document.getElementById('tightPackingToggle');
    exportBtn = document.getElementById('exportPdfBtn');
    printBtn = document.getElementById('printBtn');

    modal = document.getElementById('printPreviewModal');
    modalImg = document.getElementById('printPreviewImg');
    modalSizeText = document.getElementById('printPreviewSizeText');
    modalActualSizeToggle = document.getElementById('printActualSizeToggle');
    modalHint = document.getElementById('printPreviewHint');
    modalDownloadBtn = document.getElementById('printPreviewDownloadBtn');
    modalPrintBtn = document.getElementById('printPreviewPrintBtn');
    modalCloseBtn = document.getElementById('printPreviewCloseBtn');
  }

  function emitChange() {
    document.dispatchEvent(new CustomEvent('printlayout:change', {
      detail: {
        marginIn: state.marginIn,
        watermark: { ...state.watermark },
        showCuttingGuide: state.showCuttingGuide,
        tightPacking: state.tightPacking,
      },
    }));
  }

  /** Raw selection state, for Save/Recopy (Step 5). */
  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  /** Restores a saved selection and syncs the Step 4 controls to match. */
  function setState(saved) {
    state = {
      marginIn: saved.marginIn,
      watermark: { ...saved.watermark },
      showCuttingGuide: saved.showCuttingGuide != null ? saved.showCuttingGuide : true,
      tightPacking: !!saved.tightPacking,
    };
    marginInput.value = state.marginIn;
    watermarkToggle.checked = state.watermark.enabled;
    watermarkControls.classList.toggle('is-hidden', !state.watermark.enabled);
    watermarkTextInput.value = state.watermark.text;
    cuttingGuideToggle.checked = state.showCuttingGuide;
    tightPackingToggle.checked = state.tightPacking;
    emitChange();
  }

  /**
   * jsPDF's ESM build (dist/jspdf.es.min.js) has an unbundled bare-specifier
   * import for a Babel helper that only resolves under a bundler/import
   * map — it 404s as a plain dynamic import() in a browser. The UMD build
   * (dist/jspdf.umd.min.js) is fully self-contained instead, so it's
   * loaded the same way Fabric is: a plain <script> tag, just injected
   * lazily instead of being in index.html from the start, since PDF
   * export isn't always used. Exposes `window.jspdf.jsPDF`.
   */
  function loadJsPDF() {
    if (jsPDFCtor) return Promise.resolve(jsPDFCtor);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/jspdf-4.2.1.umd.min.js';
      script.onload = () => {
        jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (jsPDFCtor) resolve(jsPDFCtor);
        else reject(new Error('jsPDF loaded but window.jspdf.jsPDF was not found'));
      };
      script.onerror = () => reject(new Error('Failed to load vendor/jspdf-4.2.1.umd.min.js'));
      document.head.appendChild(script);
    });
  }

  function setModalBusy(isBusy, message) {
    modalDownloadBtn.disabled = isBusy;
    modalPrintBtn.disabled = isBusy;
    modalHint.textContent = message || '';
  }

  function openModal() {
    const sheet = LivePreview.getSheet();
    const exportCanvas = document.createElement('canvas');
    LivePreview.renderToCanvas(exportCanvas, EXPORT_PPI);
    modalImg.src = exportCanvas.toDataURL('image/png');
    modalSizeText.textContent = `${sheet.widthIn.toFixed(2)} × ${sheet.heightIn.toFixed(2)} in`;
    setModalBusy(false, '');
    modal.classList.remove('is-hidden');
  }

  function closeModal() {
    modal.classList.add('is-hidden');
  }

  async function handleDownloadPdf() {
    setModalBusy(true, 'First export downloads a small PDF library — needs an internet connection once.');
    try {
      const JsPDF = await loadJsPDF();
      const sheet = LivePreview.getSheet();
      const exportCanvas = document.createElement('canvas');
      LivePreview.renderToCanvas(exportCanvas, EXPORT_PPI);
      const imgData = exportCanvas.toDataURL('image/png');

      const doc = new JsPDF({ unit: 'in', format: [sheet.widthIn, sheet.heightIn] });
      doc.addImage(imgData, 'PNG', 0, 0, sheet.widthIn, sheet.heightIn);
      doc.save('printpix-rush-id.pdf');

      setModalBusy(false, 'PDF downloaded.');
    } catch (err) {
      console.error('PDF export failed:', err);
      setModalBusy(false, 'Export failed — check your connection and try again.');
    }
  }

  function handlePrint() {
    const sheet = LivePreview.getSheet();
    const exportCanvas = document.createElement('canvas');
    LivePreview.renderToCanvas(exportCanvas, EXPORT_PPI);
    const imgData = exportCanvas.toDataURL('image/png');
    const actualSize = modalActualSizeToggle.checked;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const pageCss = actualSize ? `@page { size: ${sheet.widthIn}in ${sheet.heightIn}in; margin: 0; }` : '';
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>
      ${pageCss}
      html, body { margin: 0; padding: 0; }
      img { width: ${sheet.widthIn}in; height: ${sheet.heightIn}in; display: block; }
    </style></head><body><img src="${imgData}" /></body></html>`);
    doc.close();

    setModalBusy(true, 'Opening your printer dialog…');
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setModalBusy(false, '');
      setTimeout(() => document.body.removeChild(iframe), 1000);
    };
  }

  function init() {
    cacheDom();

    marginInput.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v < 0) return;
      state.marginIn = v;
      emitChange();
    });

    watermarkToggle.addEventListener('change', (e) => {
      state.watermark.enabled = e.target.checked;
      watermarkControls.classList.toggle('is-hidden', !e.target.checked);
      emitChange();
    });

    watermarkTextInput.addEventListener('input', (e) => {
      state.watermark.text = e.target.value;
      emitChange();
    });

    cuttingGuideToggle.addEventListener('change', (e) => {
      state.showCuttingGuide = e.target.checked;
      emitChange();
    });

    tightPackingToggle.addEventListener('change', (e) => {
      state.tightPacking = e.target.checked;
      emitChange();
    });

    exportBtn.addEventListener('click', openModal);
    printBtn.addEventListener('click', openModal);
    modalCloseBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    modalDownloadBtn.addEventListener('click', handleDownloadPdf);
    modalPrintBtn.addEventListener('click', handlePrint);

    // Initial paint so LivePreview still gets a first value.
    emitChange();
  }

  return { init, getState, setState };
})();
