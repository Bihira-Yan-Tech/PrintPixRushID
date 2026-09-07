/**
 * CanvasEditor module
 * Owns the interactive Edit workspace, built on Fabric.js (loaded eagerly
 * via a plain <script> tag in index.html pointing at a self-hosted copy
 * in `vendor/`, not a CDN — this is core, always-needed functionality,
 * so it needed to work fully offline, unlike bg-removal which stays
 * CDN-only since self-hosting its AI model assets is a bigger job; see
 * CLAUDE.md).
 *
 * IMPORTANT MODEL CHANGE from the original single-canvas version: this
 * workspace represents ONE reference ID cell (a fixed WORK_SIZE×WORK_SIZE
 * square), not the whole physical sheet. That's what makes "drag/resize
 * the photo to frame it, then it appears in every copy" work once a sheet
 * can hold multiple *different* ID sizes (Step 3) — there's no single
 * "contain-fit to the sheet" framing that would make sense for a 1×1 cell
 * and a 2×2 cell at once. The reference frame is always square (matches
 * 1×1 / 1.5×1.5 / 2×2); Passport/custom non-square sizes still contain-fit
 * the flattened composite at render time in LivePreview — not pixel-
 * identical framing across mismatched aspect ratios, but no distortion.
 *
 * The photo is a single Fabric.Image object — select, drag, and resize
 * come for free from Fabric's built-in object controls, no hand-rolled
 * hit-testing. "Crop" is just: the workspace canvas only rasterizes
 * what's inside its own fixed bounds (via Fabric's toCanvasElement()),
 * so panning/resizing the photo *is* the crop — same interaction model
 * as most ID-photo / social apps, no separate marquee crop tool.
 *
 * There used to be a second, independently-draggable "attire" Fabric
 * object (a vector illustration or an uploaded PNG, manually aligned) —
 * removed in favor of AiAttireAssistant, which calls a real AI image
 * provider to generate the person actually wearing formal attire and
 * replaces the photo's own pixels with the result (same mechanism as
 * Auto Enhance's setEnhancedPhoto()), so there's nothing left to
 * separately position/resize. See CLAUDE.md.
 *
 * "Workspace zoom" (the zoom slider/buttons) scales the whole canvas view
 * — like Photoshop's canvas zoom — via Fabric's setZoom() *combined with*
 * growing the canvas element's actual DOM size, so the existing
 * `.stage-scroll` (overflow:auto) container can pan it with native
 * scrollbars. It does not change the photo's framing — only drag and
 * resize do that.
 *
 * Background (solid color / custom image / "not chosen yet" checkerboard)
 * stays outside Fabric entirely — it's applied as CSS on #sheetFrame,
 * behind the (transparent) Fabric canvas. That's deliberate: it means
 * Fabric's toCanvasElement() naturally captures ONLY the photo itself
 * (no background baked in), which is exactly what gets
 * broadcast via "photo:change" — LivePreview/PDF export re-draw the
 * background per-cell at each cell's actual pixel size for quality,
 * instead of it being baked into one fixed-resolution bitmap.
 */
const CanvasEditor = (() => {

  const WORK_SIZE = 500;        // fixed reference-cell canvas size, CSS px at 100% zoom
  const EXPORT_MULTIPLIER = 3;  // flattened composite renders at WORK_SIZE * this
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;

  const MAX_HISTORY = 20; // full-state snapshots (see pushHistory) — capped since each one embeds image data URLs

  let fabricCanvas;
  let sheetFrame, dropHint, zoomLabelText, statusDot, statusText;
  let replaceBtn, zoomRange, zoomOutBtn, zoomInBtn, zoomFitBtn, autoFitBtn, uploadHint;
  let deleteLayerBtn;
  let eraserBtn, eraserBtnText, eraserControls, eraserSizeRange;
  let undoBtn, redoBtn;

  let eraserActive = false;
  let eraserSize = 24;
  let eraserCursorCircle = null; // Fabric.Circle overlay tracking the pointer — shows the brush's real reach

  let historyStack = [];
  let historyIndex = -1;
  let restoringHistory = false; // guards against undo/redo itself pushing a new history entry

  let photoObj = null;   // Fabric.Image | null — the framed photo
  let originalFile = null; // File | null — kept for the bg-removal model input
  let cutout = null;       // HTMLImageElement | null — transparent PNG result, if bg was removed
  let viewZoom = 1;

  let background = { mode: 'none', color: '#FFFFFF', image: null, imageDataUrl: null };
  // mode: 'none' (checkerboard once a cutout exists, else plain white) | 'color' | 'image'

  function cacheDom() {
    sheetFrame = document.getElementById('sheetFrame');
    dropHint = document.getElementById('dropHint');
    zoomLabelText = document.getElementById('zoomLabelText');
    statusDot = document.getElementById('statusDot');
    statusText = document.getElementById('statusText');
    replaceBtn = document.getElementById('replaceBtn');
    zoomRange = document.getElementById('zoomRange');
    zoomOutBtn = document.getElementById('zoomOutBtn');
    zoomInBtn = document.getElementById('zoomInBtn');
    zoomFitBtn = document.getElementById('zoomFitBtn');
    autoFitBtn = document.getElementById('autoFitBtn');
    uploadHint = document.getElementById('uploadHint');
    eraserBtn = document.getElementById('eraserBtn');
    eraserBtnText = document.getElementById('eraserBtnText');
    eraserControls = document.getElementById('eraserControls');
    eraserSizeRange = document.getElementById('eraserSizeRange');
    deleteLayerBtn = document.getElementById('deleteLayerBtn');
    undoBtn = document.getElementById('undoBtn');
    redoBtn = document.getElementById('redoBtn');
  }

  // ---- Fabric object stacking helper (method name moved between
  // Fabric major versions — fall back defensively rather than assume). ----
  function sendToBack(obj) {
    if (!obj) return;
    if (typeof fabricCanvas.sendObjectToBack === 'function') fabricCanvas.sendObjectToBack(obj);
    else if (typeof fabricCanvas.sendToBack === 'function') fabricCanvas.sendToBack(obj);
  }

  function initFabricCanvas() {
    fabricCanvas = new fabric.Canvas('sheetCanvas', {
      selection: false, // only the photo is ever selectable — no marquee-select needed
      preserveObjectStacking: true,
    });
    fabricCanvas.setDimensions({ width: WORK_SIZE, height: WORK_SIZE });

    let broadcastQueued = false;
    const queueBroadcast = () => {
      if (broadcastQueued) return;
      broadcastQueued = true;
      requestAnimationFrame(() => { broadcastQueued = false; broadcastChange(); });
    };
    fabricCanvas.on('object:moving', queueBroadcast);
    fabricCanvas.on('object:scaling', queueBroadcast);
    fabricCanvas.on('object:modified', broadcastChange);

    // Keep "Delete photo" enabled/disabled in sync with selection.
    fabricCanvas.on('selection:created', syncLayerButtons);
    fabricCanvas.on('selection:updated', syncLayerButtons);
    fabricCanvas.on('selection:cleared', syncLayerButtons);

    // Eraser: each finished free-drawn stroke becomes a mask, see handleEraseStroke().
    fabricCanvas.on('path:created', (e) => handleEraseStroke(e.path));
    // Eraser brush-size cursor circle — see setEraserMode()/handleEraserPointerMove().
    fabricCanvas.on('mouse:move', handleEraserPointerMove);
    fabricCanvas.on('mouse:out', hideEraserCursor);
  }

  function syncLayerButtons() {
    const active = fabricCanvas.getActiveObject();
    deleteLayerBtn.disabled = !active;
  }

  function wireLayerControls() {
    deleteLayerBtn.addEventListener('click', deleteSelected);
  }

  /** Removes the photo entirely (back to the empty drop-zone, same as never having uploaded). */
  function deleteSelected() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active !== photoObj) return;

    fabricCanvas.remove(photoObj);
    photoObj = null;
    originalFile = null;
    cutout = null;
    updateDomForPhotoPresence();
    setStatus(false, 'No image loaded');
    uploadHint.textContent = 'Upload a photo to begin editing.';

    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    syncLayerButtons();
    pushHistory();
    broadcastChange();
  }

  // ---- Undo / Redo ----
  // Each entry is a full getSaveState() snapshot (see below) — simplest
  // way to get correct undo/redo is to reuse the same serialization
  // Save/Recopy already relies on, rather than tracking per-field diffs.
  // Capped at MAX_HISTORY entries since each snapshot embeds image data
  // URLs; older entries just fall off the back of the stack.

  function updateHistoryButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= historyStack.length - 1;
  }

  function pushHistory() {
    if (restoringHistory) return;
    const snapshot = getSaveState();
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(snapshot);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    historyIndex = historyStack.length - 1;
    updateHistoryButtons();
  }

  /** Resets history to a single baseline entry — call after init or after loadState() restores a whole job. */
  function resetHistory() {
    historyStack = [getSaveState()];
    historyIndex = 0;
    updateHistoryButtons();
  }

  /**
   * Notifies bgRemoval.js to re-sync its own swatch DOM after a history
   * jump — loadState() only restores the Fabric objects + internal
   * state, same as it does for Save/Recopy (which separately calls
   * BgRemoval.syncUI() right after CanvasEditor.loadState() — see
   * saveRecopy.js). Undo/redo needs that same follow-up, just via an
   * event instead of a direct call, since canvasEditor.js doesn't
   * reference that module directly.
   */
  function notifyHistoryRestored() {
    document.dispatchEvent(new CustomEvent('editstate:restored', { detail: getSaveState() }));
  }

  async function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    restoringHistory = true;
    await loadState(historyStack[historyIndex], { quiet: true });
    restoringHistory = false;
    updateHistoryButtons();
    notifyHistoryRestored();
  }

  async function redo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    restoringHistory = true;
    await loadState(historyStack[historyIndex], { quiet: true });
    restoringHistory = false;
    updateHistoryButtons();
    notifyHistoryRestored();
  }

  function wireHistoryControls() {
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
  }

  // ---- Eraser (simple brush — no AI, no model download) ----
  // Draw strokes with Fabric's own free-drawing brush; each finished
  // stroke becomes a mask that's punched out of the photo via canvas
  // "destination-out" compositing. NOT content-aware fill — erased
  // areas become plain transparent, same as a Photoshop eraser with no
  // background layer. Simplification: erasing flattens the photo's
  // current crop/position into a new bitmap (at EXPORT_MULTIPLIER
  // resolution, same quality tier as PDF/print export) — further
  // drag/resize afterward moves that flattened result, not the
  // original source image.
  //
  // A visible dashed circle (eraserCursorCircle) tracks the pointer at
  // the brush's actual on-canvas size, in the same scene coordinate
  // space as the brush itself — so it stays accurate at any workspace
  // zoom level, unlike a fixed-size OS cursor image. The native cursor
  // is hidden (freeDrawingCursor: 'none') while erasing so only this
  // circle shows.

  /**
   * Runs `fn()` (a toCanvasElement() capture) with the canvas's zoom
   * and backing resolution reset to a neutral 1:1 WORK_SIZE frame.
   *
   * Why this exists: applyZoom() intentionally grows the Fabric
   * canvas's actual backing width/height with the workspace zoom level
   * (so `.stage-scroll` has real content to scroll/pan when zoomed in —
   * see applyZoom()'s own comment). But Fabric's toCanvasElement(mult)
   * bases its output size on the canvas's *current* width/height and
   * zoom, not a fixed WORK_SIZE — so calling it while zoomed produced a
   * flattened bitmap scaled to the CURRENT view zoom instead of true
   * 1:1 scale. Every caller here (flattenComposite, the eraser) assumes
   * a fixed WORK_SIZE*multiplier output; without this, anything flattened
   * while not exactly at 100% workspace zoom came out shrunk (zoomed
   * out) or cropped (zoomed in) — this was the "eraser shrinks the
   * photo" bug. Also hides eraserCursorCircle for the duration, since
   * it's a UI overlay that must never end up baked into an exported/
   * flattened bitmap.
   */
  function withNeutralZoom(fn) {
    const savedZoom = viewZoom;
    const needsReset = savedZoom !== 1;
    if (needsReset) {
      fabricCanvas.setZoom(1);
      fabricCanvas.setDimensions({ width: WORK_SIZE, height: WORK_SIZE });
    }
    const cursorWasVisible = eraserCursorCircle ? eraserCursorCircle.visible : false;
    if (eraserCursorCircle) eraserCursorCircle.set('visible', false);

    const result = fn();

    if (eraserCursorCircle) eraserCursorCircle.set('visible', cursorWasVisible);
    if (needsReset) {
      const px = Math.round(WORK_SIZE * savedZoom); // matches applyZoom()'s own rounding
      fabricCanvas.setZoom(savedZoom);
      fabricCanvas.setDimensions({ width: px, height: px });
    }
    fabricCanvas.requestRenderAll();
    return result;
  }

  function updateEraserCursorRadius() {
    if (!eraserCursorCircle) return;
    eraserCursorCircle.set({ radius: eraserSize / 2 });
    eraserCursorCircle.setCoords();
    fabricCanvas.requestRenderAll();
  }

  function handleEraserPointerMove(opt) {
    if (!eraserCursorCircle) return;
    const p = fabricCanvas.getScenePoint(opt.e);
    eraserCursorCircle.set({ left: p.x, top: p.y, visible: true });
    // Fabric's skipOffscreen viewport culling (on by default) decides
    // whether to render an object using its CACHED aCoords bounding
    // box, not its live left/top — plain .set() doesn't refresh that
    // cache, only setCoords() does. Without this call the circle was
    // permanently treated as still sitting at its initial off-canvas
    // spawn position and silently skipped every render, however
    // correct its actual left/top/visible properties were (this was
    // the real bug behind the cursor circle never appearing on screen).
    eraserCursorCircle.setCoords();
    fabricCanvas.requestRenderAll();
  }

  function hideEraserCursor() {
    if (!eraserCursorCircle) return;
    eraserCursorCircle.set('visible', false);
    fabricCanvas.requestRenderAll();
  }

  function setEraserMode(on) {
    eraserActive = on;
    fabricCanvas.isDrawingMode = on;
    if (on) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
      fabricCanvas.freeDrawingBrush.width = eraserSize;
      fabricCanvas.freeDrawingBrush.color = 'rgba(255,255,255,1)';

      eraserCursorCircle = new fabric.Circle({
        radius: eraserSize / 2,
        left: -1000, top: -1000, // offscreen until the first pointer move
        originX: 'center', originY: 'center',
        fill: 'rgba(255,255,255,0.15)',
        stroke: 'rgba(20,25,43,0.85)',
        strokeWidth: 1,
        strokeDashArray: [4, 3],
        strokeUniform: true,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        visible: false,
      });
      fabricCanvas.add(eraserCursorCircle);
      fabricCanvas.freeDrawingCursor = 'none';
    } else if (eraserCursorCircle) {
      fabricCanvas.remove(eraserCursorCircle);
      eraserCursorCircle = null;
      fabricCanvas.freeDrawingCursor = 'crosshair';
    }
    fabricCanvas.requestRenderAll();
    eraserBtn.classList.toggle('is-active', on);
    eraserBtnText.textContent = on ? 'Erasing… (click to stop)' : 'Eraser';
    eraserControls.classList.toggle('is-hidden', !on);
    syncLayerButtons();
  }

  function setEraserSize(px) {
    eraserSize = px;
    if (fabricCanvas.freeDrawingBrush) fabricCanvas.freeDrawingBrush.width = px;
    updateEraserCursorRadius();
  }

  /** Punches `pathObj` (a just-drawn stroke) out of the current photo, then removes the stroke itself. */
  function handleEraseStroke(pathObj) {
    if (!photoObj) { fabricCanvas.remove(pathObj); return; }

    const mult = EXPORT_MULTIPLIER;
    const size = WORK_SIZE * mult;

    const { beforeCanvas, maskCanvas } = withNeutralZoom(() => {
      pathObj.set('visible', false);
      const before = fabricCanvas.toCanvasElement(mult);

      photoObj.set('visible', false);
      pathObj.set('visible', true);
      const mask = fabricCanvas.toCanvasElement(mult);

      photoObj.set('visible', true);
      return { beforeCanvas: before, maskCanvas: mask };
    });

    fabricCanvas.remove(pathObj);

    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const octx = out.getContext('2d');
    octx.drawImage(beforeCanvas, 0, 0);
    octx.globalCompositeOperation = 'destination-out';
    octx.drawImage(maskCanvas, 0, 0);

    const img = new fabric.Image(out);
    setPhotoObject(img, { left: 0, top: 0, scaleX: 1 / mult, scaleY: 1 / mult, angle: 0 }); // pushes history itself
  }

  /** Flattens the photo (NOT the background swatch) to an offscreen canvas. */
  function flattenComposite() {
    return withNeutralZoom(() => fabricCanvas.toCanvasElement(EXPORT_MULTIPLIER));
  }

  function broadcastChange() {
    document.dispatchEvent(new CustomEvent('photo:change', {
      detail: {
        image: photoObj ? flattenComposite() : null,
        background: { ...background },
      },
    }));
  }

  // ---- Background (CSS layer behind the transparent Fabric canvas) ----

  function applyBackgroundCss() {
    sheetFrame.classList.remove('is-checker');
    if (background.mode === 'color') {
      sheetFrame.style.backgroundImage = 'none';
      sheetFrame.style.backgroundColor = background.color;
    } else if (background.mode === 'image' && background.imageDataUrl) {
      sheetFrame.style.backgroundColor = '';
      sheetFrame.style.backgroundImage = `url(${background.imageDataUrl})`;
      sheetFrame.style.backgroundSize = 'cover';
      sheetFrame.style.backgroundPosition = 'center';
    } else {
      sheetFrame.style.backgroundImage = 'none';
      sheetFrame.style.backgroundColor = '#ffffff';
      if (cutout) sheetFrame.classList.add('is-checker');
    }
  }

  function setBackgroundColor(hex) {
    background = { mode: 'color', color: hex, image: null, imageDataUrl: null };
    applyBackgroundCss();
    broadcastChange();
    pushHistory();
  }

  function setBackgroundImage(img) {
    const dataUrl = imageToDataUrl(img, 1600);
    background = { mode: 'image', color: background.color, image: img, imageDataUrl: dataUrl };
    applyBackgroundCss();
    broadcastChange();
    pushHistory();
  }

  function clearBackground() {
    background = { mode: 'none', color: background.color, image: null, imageDataUrl: null };
    applyBackgroundCss();
    broadcastChange();
    pushHistory();
  }

  // ---- Photo object ----

  function updateDomForPhotoPresence() {
    const has = !!photoObj;
    dropHint.classList.toggle('is-filled', has);
    replaceBtn.disabled = !has;
    autoFitBtn.disabled = !has;
    eraserBtn.disabled = !has;
    if (!has && eraserActive) setEraserMode(false);
    syncLayerButtons();
  }

  function setStatus(ready, label) {
    statusDot.classList.toggle('is-ready', ready);
    statusText.textContent = label;
  }

  /** `fabricImg` is an already-constructed Fabric.Image; `transform` (optional) restores an exact position/scale instead of auto-centering. */
  function setPhotoObject(fabricImg, transform) {
    if (photoObj) fabricCanvas.remove(photoObj);
    fabricImg.set({ selectable: true, hasControls: true, hasBorders: true, originX: 'left', originY: 'top' });
    if (transform) {
      fabricImg.set(transform);
    } else {
      const scale = Math.min(WORK_SIZE / fabricImg.width, WORK_SIZE / fabricImg.height);
      fabricImg.set({
        scaleX: scale,
        scaleY: scale,
        left: (WORK_SIZE - fabricImg.width * scale) / 2,
        top: (WORK_SIZE - fabricImg.height * scale) / 2,
      });
    }
    photoObj = fabricImg;
    fabricCanvas.add(photoObj);
    sendToBack(photoObj);
    fabricCanvas.setActiveObject(photoObj);
    fabricCanvas.requestRenderAll();
    updateDomForPhotoPresence();
    broadcastChange();
    pushHistory();
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    fabric.Image.fromURL(url).then((img) => {
      URL.revokeObjectURL(url);
      originalFile = file;
      cutout = null;
      background = { mode: 'none', color: '#FFFFFF', image: null, imageDataUrl: null };
      applyBackgroundCss();
      setPhotoObject(img, null);
      uploadHint.textContent = 'Photo loaded — drag or resize it to frame the shot. Try Remove Background next.';
      setStatus(true, file.name);
      document.dispatchEvent(new CustomEvent('upload:change', { detail: { file, image: img } }));
    }).catch(() => setStatus(false, 'Could not read that file'));
  }

  function setCutout(imgEl) {
    cutout = imgEl;
    const transform = photoObj
      ? { left: photoObj.left, top: photoObj.top, scaleX: photoObj.scaleX, scaleY: photoObj.scaleY, angle: photoObj.angle }
      : null;
    setPhotoObject(new fabric.Image(imgEl), transform);
    applyBackgroundCss();
  }

  /** The photo's underlying <img>/<canvas> element, or null if there's no photo. */
  function getPhotoElement() {
    if (!photoObj) return null;
    return typeof photoObj.getElement === 'function' ? photoObj.getElement() : photoObj._element;
  }

  /**
   * Swaps in a processed version of the current photo (from Auto
   * Enhance) while keeping the exact same on-canvas framing. Auto
   * Enhance doesn't change pixel dimensions, so this is normally a
   * plain swap — the scale-adjustment math is kept anyway (harmless
   * no-op when dimensions match) since it's cheap and makes this safe
   * to reuse for anything that might change resolution later too.
   */
  function setEnhancedPhoto(imgEl) {
    if (!photoObj) return;
    const scaleAdjustX = photoObj.width / imgEl.width;
    const scaleAdjustY = photoObj.height / imgEl.height;
    const transform = {
      left: photoObj.left,
      top: photoObj.top,
      scaleX: photoObj.scaleX * scaleAdjustX,
      scaleY: photoObj.scaleY * scaleAdjustY,
      angle: photoObj.angle,
    };
    setPhotoObject(new fabric.Image(imgEl), transform);
  }

  /** One-shot "Auto-fit face" — crops toward the head using a heuristic, then the user can fine-tune by dragging. */
  function autoFitFace() {
    if (!photoObj) return;
    const el = getPhotoElement();
    const { sx, sy, sw } = FaceFitHeuristic.computeFaceFitCrop(el, WORK_SIZE, WORK_SIZE);
    const scale = WORK_SIZE / sw;
    photoObj.set({ scaleX: scale, scaleY: scale, left: -sx * scale, top: -sy * scale });
    photoObj.setCoords();
    fabricCanvas.requestRenderAll();
    broadcastChange();
    pushHistory();
  }

  // ---- Workspace zoom (view only — never touches photo framing) ----

  function applyZoom(z) {
    viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const px = Math.round(WORK_SIZE * viewZoom);
    fabricCanvas.setZoom(viewZoom);
    fabricCanvas.setDimensions({ width: px, height: px });
    sheetFrame.style.width = px + 'px';
    sheetFrame.style.height = px + 'px';
    zoomRange.value = Math.round(viewZoom * 100);
    zoomLabelText.textContent = `${Math.round(viewZoom * 100)}%`;
    fabricCanvas.requestRenderAll();
  }

  function wireZoomControls() {
    zoomRange.addEventListener('input', (e) => applyZoom(Number(e.target.value) / 100));
    zoomOutBtn.addEventListener('click', () => applyZoom(viewZoom - 0.25));
    zoomInBtn.addEventListener('click', () => applyZoom(viewZoom + 0.25));
    zoomFitBtn.addEventListener('click', () => applyZoom(1));
  }

  function wireUploadEvents() {
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');

    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));
    replaceBtn.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(evt =>
      sheetFrame.addEventListener(evt, (e) => {
        e.preventDefault();
        dropHint.classList.add('is-dragover');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      sheetFrame.addEventListener(evt, (e) => {
        e.preventDefault();
        dropHint.classList.remove('is-dragover');
      })
    );
    sheetFrame.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

    autoFitBtn.addEventListener('click', autoFitFace);
  }

  // ---- Save/Recopy (Step 5) ----

  /** Downscales `el` (HTMLImageElement or HTMLCanvasElement) to at most `maxEdge` px and returns a PNG data URL. */
  function imageToDataUrl(el, maxEdge) {
    if (!el) return null;
    const srcW = el.naturalWidth || el.width;
    const srcH = el.naturalHeight || el.height;
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(el, 0, 0, w, h);
    return c.toDataURL('image/png');
  }

  function loadImageFromUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      if (!dataUrl) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function getObjTransform(obj) {
    if (!obj) return null;
    return { left: obj.left, top: obj.top, scaleX: obj.scaleX, scaleY: obj.scaleY, angle: obj.angle || 0 };
  }

  /**
   * Serializes the current edit for Save/Recopy. Deliberately hand-rolls
   * transform + image data URLs instead of Fabric's canvas.toJSON() —
   * toJSON() would capture each object's *original* src (a blob: URL for
   * an uploaded photo), which gets revoked right after load and is
   * useless on restore. Snapshotting each object's current pixels to a
   * data URL here sidesteps that.
   */
  function getSaveState() {
    return {
      photoDataUrl: photoObj ? imageToDataUrl(photoObj.getElement(), 1600) : null,
      photoTransform: getObjTransform(photoObj),
      background: {
        mode: background.mode,
        color: background.color,
        imageDataUrl: background.mode === 'image' ? background.imageDataUrl : null,
      },
    };
  }

  /**
   * Restores a saved edit (see getSaveState) — the photo stays fully
   * editable afterward, not flattened. `quiet` is used internally by
   * undo/redo: skips the "restored from a saved job" status text and,
   * critically, does NOT call resetHistory() (which would wipe the very
   * undo/redo stack this is being called from) — the outer
   * restoringHistory flag is also preserved rather than force-cleared,
   * so a loadState() called *during* an undo/redo doesn't let its own
   * internal setPhotoObject() calls push new history entries.
   *
   * Jobs saved before the old attire-overlay system was removed may
   * still carry `attireEnabled`/`attireSourceKey`/etc. fields — they're
   * simply ignored here now, not migrated; there's nothing left to
   * restore them into.
   */
  async function loadState(saved, opts) {
    const quiet = !!(opts && opts.quiet);
    const wasRestoringHistory = restoringHistory;
    restoringHistory = true;

    if (saved.photoDataUrl) {
      const img = await fabric.Image.fromURL(saved.photoDataUrl);
      originalFile = null; // the original File never survives a save/reload — see Known simplifications
      cutout = null;
      setPhotoObject(img, saved.photoTransform);
    } else if (photoObj) {
      fabricCanvas.remove(photoObj);
      photoObj = null;
      updateDomForPhotoPresence();
    }

    const bgImg = saved.background && saved.background.mode === 'image' && saved.background.imageDataUrl
      ? await loadImageFromUrl(saved.background.imageDataUrl)
      : null;
    background = saved.background
      ? { mode: saved.background.mode, color: saved.background.color, image: bgImg, imageDataUrl: saved.background.imageDataUrl }
      : { mode: 'none', color: '#FFFFFF', image: null, imageDataUrl: null };
    applyBackgroundCss();

    if (!quiet) {
      uploadHint.textContent = photoObj
        ? 'Photo restored from a saved job. Background removal needs a fresh upload to run again.'
        : 'Upload a photo to begin editing.';
      setStatus(!!photoObj, photoObj ? 'Restored from saved job' : 'No image loaded');
    } else {
      // Undo/redo: still reflect ready/not-ready correctly, just without
      // the "restored from a saved job" wording (this isn't that).
      setStatus(!!photoObj, photoObj ? 'Photo' : 'No image loaded');
    }
    syncLayerButtons();
    broadcastChange();

    restoringHistory = wasRestoringHistory;
    if (!quiet) resetHistory();
  }

  function getOriginalFile() { return originalFile; }

  function wireEraserControls() {
    eraserBtn.addEventListener('click', () => setEraserMode(!eraserActive));
    eraserSizeRange.addEventListener('input', (e) => setEraserSize(Number(e.target.value)));
  }

  function init() {
    cacheDom();
    initFabricCanvas();
    wireUploadEvents();
    wireZoomControls();
    wireLayerControls();
    wireEraserControls();
    wireHistoryControls();
    resetHistory();
    applyZoom(1);
    updateDomForPhotoPresence();
  }

  return {
    init, getSaveState, loadState, getOriginalFile,
    setCutout, setBackgroundColor, setBackgroundImage, clearBackground,
    autoFitFace, getPhotoElement, setEnhancedPhoto,
    undo, redo,
  };
})();
