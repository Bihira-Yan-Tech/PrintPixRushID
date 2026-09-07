/**
 * LivePreview module
 * Mirrors whatever is happening in the Edit pane (CanvasEditor) as an
 * auto-arranged, auto-packed layout of copies on the full sheet, complete
 * with cutting guides. Listens for "pagesetup:change", "photo:change",
 * "idsize:change" and "printlayout:change" and redraws immediately — no
 * separate "generate preview" step.
 *
 * "photo:change" now carries an already-composed image (photo + attire
 * flattened together by CanvasEditor's Fabric.js workspace) plus the
 * background choice — this module just contain-fits that composite into
 * each cell and draws the chosen background beneath it. It doesn't know
 * anything about attire, zoom, or crop anymore; all of that lives
 * upstream in CanvasEditor.
 *
 * Step 3 (idSize.js) can add *multiple different sizes* to one sheet, each
 * with its own quantity — nothing shows here until at least one has been
 * added ("Add to sheet"). packEntries() below packs all of them onto the
 * sheet with a greedy shelf-packing heuristic (see its own comment) —
 * not an optimal bin-packer, but simple, deterministic, and good enough
 * for a single print sheet.
 *
 * Sheet margin and the watermark/proofing overlay come from Step 4
 * (printExport.js) via "printlayout:change".
 *
 * All the actual drawing lives in drawFrame(), which takes an explicit
 * ctx/width/height instead of reading the on-screen canvas directly. That
 * lets renderToCanvas() reuse the exact same layout logic to rasterize the
 * sheet at print resolution for PDF export (see printExport.js), so the
 * on-screen preview and the exported PDF can never drift apart.
 */
const LivePreview = (() => {

  const SCREEN_PPI = 96;
  const MAX_STAGE_PX = 560;
  const GAP_IN = 0.08;
  const NAME_TAG_DEFAULT_COLOR = '#16A34A';
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;

  let canvas, ctx, frame, sheetDimsLabel, countLabel;
  let zoomLabel, zoomOutBtn, zoomInBtn, zoomFitBtn;

  let sheet = { widthIn: 4, heightIn: 6 };
  let entries = []; // [{ widthIn, heightIn, quantity }], empty until Step 3 "Add to sheet"
  let nameTag = { enabled: false, text: '', color: NAME_TAG_DEFAULT_COLOR };
  let marginIn = 0.2; // default sheet margin, until printlayout:change fires
  let watermark = { enabled: false, text: 'PROOF' };
  let showCuttingGuide = true;
  let tightPacking = false;
  let photo = { image: null, background: { mode: 'none', color: '#FFFFFF', image: null } };
  let previewZoom = 1; // this pane's own zoom, independent of CanvasEditor's workspace zoom

  function cacheDom() {
    canvas = document.getElementById('previewCanvas');
    ctx = canvas.getContext('2d');
    frame = document.getElementById('previewFrame');
    sheetDimsLabel = document.getElementById('previewIdSizeText');
    countLabel = document.getElementById('previewCountText');
    zoomLabel = document.getElementById('previewZoomLabel');
    zoomOutBtn = document.getElementById('previewZoomOutBtn');
    zoomInBtn = document.getElementById('previewZoomInBtn');
    zoomFitBtn = document.getElementById('previewZoomFitBtn');
  }

  function layoutCanvas() {
    const longestIn = Math.max(sheet.widthIn, sheet.heightIn);
    const baseScale = MAX_STAGE_PX / (longestIn * SCREEN_PPI);
    const scale = baseScale * previewZoom;
    const wPx = Math.round(sheet.widthIn * SCREEN_PPI * scale);
    const hPx = Math.round(sheet.heightIn * SCREEN_PPI * scale);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = wPx * dpr;
    canvas.height = hPx * dpr;
    canvas.style.width = wPx + 'px';
    canvas.style.height = hPx + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    frame.style.width = wPx + 'px';
    frame.style.height = hPx + 'px';

    sheetDimsLabel.textContent = `${sheet.widthIn.toFixed(2)} × ${sheet.heightIn.toFixed(2)} in`;
  }

  /** This pane's own zoom — independent of CanvasEditor's workspace zoom in Step 2. */
  function applyPreviewZoom(z) {
    previewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    zoomLabel.textContent = `${Math.round(previewZoom * 100)}%`;
    layoutCanvas();
    draw();
  }

  function wireZoomControls() {
    zoomOutBtn.addEventListener('click', () => applyPreviewZoom(previewZoom - 0.25));
    zoomInBtn.addEventListener('click', () => applyPreviewZoom(previewZoom + 0.25));
    zoomFitBtn.addEventListener('click', () => applyPreviewZoom(1));
  }

  /**
   * Greedy shelf-packing: sorts entries tallest-first, places cells
   * left-to-right, wraps to a new "shelf" (row) once a cell doesn't fit
   * horizontally, and stops placing once a cell doesn't fit vertically
   * either (remaining requested copies just aren't shown — same
   * single-sheet honesty as the old single-size quantity cap).
   *
   * Not a globally space-optimal bin-packer — mixing very different
   * sizes can leave some usable gaps — but simple, deterministic, and
   * good enough for a single print sheet.
   *
   * "Align Center": each shelf is centered horizontally within `usableW`
   * *independently* — not just the overall block. Without this, a shelf
   * of narrower cells (e.g. a 1×1 row under a 2×2 row) would sit flush
   * left inside the block instead of looking centered on the sheet,
   * which is the actual complaint "Align Center" was reported for. The
   * whole stack of shelves is then centered vertically as one block, same
   * as before. This isn't a manual toggle — it's just how the (always
   * live, no "regenerate" step) layout is computed every redraw.
   *
   * `gapIn` is the scissors-margin left between cells — 0 when "Tight
   * packing" (Step 4) is on, which packs cells edge-to-edge to fit more
   * on smaller paper, at the cost of needing to cut precisely along the
   * guide lines (no forgiving gap between copies).
   */
  function packEntries(list, usableW, usableH, gapIn) {
    const sorted = list.slice().sort((a, b) => b.heightIn - a.heightIn);
    let cursorX = 0, cursorY = 0, shelfH = 0;
    const shelves = [];
    let currentShelfCells = [];
    let totalRequested = 0;

    function commitShelf() {
      if (currentShelfCells.length === 0) return;
      const width = currentShelfCells.reduce((max, c) => Math.max(max, c.xIn + c.widthIn), 0);
      shelves.push({ y: cursorY, height: shelfH, width, cells: currentShelfCells });
    }

    for (const entry of sorted) {
      totalRequested += entry.quantity;
      for (let n = 0; n < entry.quantity; n++) {
        if (cursorX + entry.widthIn > usableW + 1e-6) {
          commitShelf();
          cursorX = 0;
          cursorY += shelfH + gapIn;
          shelfH = 0;
          currentShelfCells = [];
        }
        if (cursorY + entry.heightIn > usableH + 1e-6) {
          // This size no longer fits — stop placing more of it, but a
          // smaller size later in `sorted` may still fit in what's left
          // (on the same shelf, even), so move on to the next entry
          // instead of aborting entirely.
          break;
        }
        currentShelfCells.push({ xIn: cursorX, yIn: cursorY, widthIn: entry.widthIn, heightIn: entry.heightIn });
        cursorX += entry.widthIn + gapIn;
        shelfH = Math.max(shelfH, entry.heightIn);
      }
    }
    commitShelf();

    let blockBottom = 0;
    const placedCells = [];
    shelves.forEach((shelf) => {
      blockBottom = Math.max(blockBottom, shelf.y + shelf.height);
      const shelfOffsetX = Math.max(0, (usableW - shelf.width) / 2);
      shelf.cells.forEach((c) => placedCells.push({ ...c, xIn: c.xIn + shelfOffsetX }));
    });

    return { placedCells, totalRequested, blockH: blockBottom };
  }

  /** Packs all entries (each shelf already centered horizontally), then centers the stack vertically within the sheet's usable (margin-aware) area. */
  function computeLayout() {
    const usableW = sheet.widthIn - marginIn * 2;
    const usableH = sheet.heightIn - marginIn * 2;
    const packed = packEntries(entries, usableW, usableH, tightPacking ? 0 : GAP_IN);
    const offsetYIn = marginIn + Math.max(0, (usableH - packed.blockH) / 2);
    return {
      cells: packed.placedCells.map(c => ({ ...c, xIn: c.xIn + marginIn, yIn: c.yIn + offsetYIn })),
      totalRequested: packed.totalRequested,
    };
  }

  /** Contain-fits the already-composed photo+attire image into the cell. */
  function drawImageContain(targetCtx, img, x, y, w, h) {
    const containScale = Math.min(w / img.width, h / img.height);
    const drawW = img.width * containScale;
    const drawH = img.height * containScale;
    const dx = x + (w - drawW) / 2;
    const dy = y + (h - drawH) / 2;
    targetCtx.drawImage(img, dx, dy, drawW, drawH);
  }

  function drawImageCover(targetCtx, img, x, y, w, h) {
    const coverScale = Math.max(w / img.width, h / img.height);
    const drawW = img.width * coverScale;
    const drawH = img.height * coverScale;
    const dx = x + (w - drawW) / 2;
    const dy = y + (h - drawH) / 2;
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.rect(x, y, w, h);
    targetCtx.clip();
    targetCtx.drawImage(img, dx, dy, drawW, drawH);
    targetCtx.restore();
  }

  function drawCellBackground(targetCtx, x, y, w, h) {
    const bg = photo.background;
    if (bg && bg.mode === 'color') {
      targetCtx.fillStyle = bg.color;
      targetCtx.fillRect(x, y, w, h);
    } else if (bg && bg.mode === 'image' && bg.image) {
      drawImageCover(targetCtx, bg.image, x, y, w, h);
    }
    // mode 'none' → leave the sheet white; cutting guide still shows the cell
  }

  function drawNameTag(targetCtx, x, y, w, h) {
    if (!nameTag || !nameTag.enabled) return;
    const bandH = Math.max(12, h * 0.16);
    const by = y + h - bandH;
    targetCtx.fillStyle = nameTag.color || NAME_TAG_DEFAULT_COLOR;
    targetCtx.fillRect(x, by, w, bandH);
    targetCtx.fillStyle = '#FFFFFF';
    targetCtx.font = `600 ${Math.round(bandH * 0.5)}px Inter, sans-serif`;
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';
    targetCtx.fillText(nameTag.text || '', x + w / 2, by + bandH / 2 + 1, w - 8);
  }

  /** Single centered diagonal watermark — not a repeating tile pattern. */
  function drawWatermark(targetCtx, w, h) {
    if (!watermark || !watermark.enabled) return;
    const text = (watermark.text || 'PROOF').toUpperCase();
    targetCtx.save();
    targetCtx.globalAlpha = 0.16;
    targetCtx.fillStyle = '#14192B';
    targetCtx.font = `700 ${Math.round(Math.min(w, h) * 0.16)}px 'Space Grotesk', sans-serif`;
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';
    targetCtx.translate(w / 2, h / 2);
    targetCtx.rotate(-Math.PI / 6);
    targetCtx.fillText(text, 0, 0);
    targetCtx.restore();
  }

  /** Draws the full sheet (packed cells + cutting guides + watermark) into any ctx/size. */
  function drawFrame(targetCtx, w, h) {
    const pxPerIn = w / sheet.widthIn;

    targetCtx.clearRect(0, 0, w, h);
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, w, h);

    const layout = computeLayout();

    layout.cells.forEach((cell) => {
      const x = cell.xIn * pxPerIn;
      const y = cell.yIn * pxPerIn;
      const cw = cell.widthIn * pxPerIn;
      const ch = cell.heightIn * pxPerIn;

      if (photo.image) {
        drawCellBackground(targetCtx, x, y, cw, ch);
        targetCtx.save();
        targetCtx.beginPath();
        targetCtx.rect(x, y, cw, ch);
        targetCtx.clip();
        drawImageContain(targetCtx, photo.image, x, y, cw, ch);
        drawNameTag(targetCtx, x, y, cw, ch);
        targetCtx.restore();
      }

      // cutting guide
      if (showCuttingGuide) {
        targetCtx.save();
        targetCtx.strokeStyle = '#C3C8D4';
        targetCtx.setLineDash([3, 3]);
        targetCtx.lineWidth = 1;
        targetCtx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        targetCtx.restore();
      }
    });

    drawWatermark(targetCtx, w, h);

    return { placed: layout.cells.length, totalRequested: layout.totalRequested };
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const { placed, totalRequested } = drawFrame(ctx, w, h);

    if (entries.length === 0) {
      countLabel.textContent = 'No sizes added';
    } else if (placed < totalRequested) {
      countLabel.textContent = `${placed} of ${totalRequested} copies`;
    } else {
      countLabel.textContent = `${placed} copies`;
    }
  }

  /** Rasterizes the current sheet into `targetCanvas` at `ppi` pixels-per-inch. */
  function renderToCanvas(targetCanvas, ppi) {
    const wPx = Math.round(sheet.widthIn * ppi);
    const hPx = Math.round(sheet.heightIn * ppi);
    targetCanvas.width = wPx;
    targetCanvas.height = hPx;
    drawFrame(targetCanvas.getContext('2d'), wPx, hPx);
  }

  function getSheet() {
    return { ...sheet };
  }

  function init() {
    cacheDom();
    wireZoomControls();
    layoutCanvas();
    draw();

    document.addEventListener('pagesetup:change', (e) => {
      sheet = e.detail;
      layoutCanvas();
      draw();
    });

    document.addEventListener('photo:change', (e) => {
      photo = e.detail;
      draw();
    });

    document.addEventListener('idsize:change', (e) => {
      entries = e.detail.entries;
      nameTag = e.detail.nameTag;
      draw();
    });

    document.addEventListener('printlayout:change', (e) => {
      marginIn = e.detail.marginIn;
      watermark = e.detail.watermark;
      showCuttingGuide = e.detail.showCuttingGuide;
      tightPacking = e.detail.tightPacking;
      draw();
    });

    window.addEventListener('resize', () => { layoutCanvas(); draw(); });
  }

  return { init, renderToCanvas, getSheet };
})();
