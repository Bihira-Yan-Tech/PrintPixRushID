# PrintPix Rush ID — Project Notes for Claude Code

Browser-based ID photo generator & layout editor (1x1, 2x2, passport, etc).
Plain HTML/CSS/JS, no build step — works by opening `index.html` directly.

## Two independent copies: `desktop/` and `mobile/`
As of this pass, the project root holds **two self-contained copies of
the app** — `desktop/` (browser + the Electron Windows installer) and
`mobile/` (the Android APK) — each with its own `index.html`/`css/`/
`js/`/`vendor/`/`assets/`, **not** shared/symlinked from anywhere. This
was a deliberate split, requested explicitly: the two platforms are
expected to grow different needs (mobile-specific layout/zoom defaults,
a WebView file-chooser shim mobile needs and desktop doesn't, etc.), and
editing one should never risk silently breaking the other. **Every
relative file path mentioned anywhere else in this document (e.g.
`js/modules/canvasEditor.js`) is relative to whichever of these two
folders you're working in** — check which platform you're touching
before assuming a path.

They started as byte-identical copies of the same source and are
expected to drift apart over time — don't assume a fix made in one
automatically applies to the other; port it deliberately if it should,
skip it if it's platform-specific (like the mobile zoom defaults or the
WebView file-chooser fix below, which only make sense on `mobile/`).

- `desktop/` — the plain-browser experience (open `desktop/index.html`
  directly) **and** the Electron-wrapped Windows installer, since
  they're the same files, just optionally wrapped. See "Desktop app
  (Electron)" below.
- `mobile/` — the Android APK (Capacitor+Gradle project, plus the
  hand-built no-Gradle fallback that actually produced the shipped
  APK). See "Mobile app (Android)" below.
- Each has its **own** `package.json`/`node_modules` — desktop's has
  `electron`/`electron-builder`; mobile's has the `@capacitor/*`
  packages. Run `npm install` separately in each if setting up fresh.
- Shared build tooling installed OUTSIDE both folders (not
  platform-specific, no reason to duplicate): the Android SDK at
  `D:\android-sdk`, JDKs under `C:\Program Files\Eclipse Adoptium\`.
Client-side only. **Fully offline-capable for the core flow** (edit,
arrange, enhance, export PDF, print) — Fabric.js and jsPDF are
self-hosted in `vendor/`, not fetched from a CDN. Two features need
internet: "Remove Background" (Step 2), which downloads an AI model
from a CDN the first time it's used, and **Add Formal Attire**, which
always needs internet — it calls the user's configured AI provider(s)
over the network for every generation, no local/offline fallback (there
couldn't be one; that's the whole point of it being a real generative
model call). Self-hosting Remove Background's model is a bigger job
(model + WASM runtime assets) and was deliberately left
out of the offline pass; see Known simplifications.

**"AI Upscale" (TensorFlow.js + UpscalerJS) was removed and replaced
with "Auto Enhance"** — the AI pipeline (model download + WebGL
inference) kept being unreliable in practice even after fixing an
earlier WebGL-crash bug (see git history / task log), so it was
replaced entirely with plain Canvas 2D pixel math: auto-contrast +
mild saturation + light sharpen. No model, no WebGL, no download,
nothing that can hang — see `js/modules/autoEnhance.js`. It does NOT
add resolution the way the old upscaler did; it only improves the tone/
contrast/crispness of the pixels already there.

**AI Eraser was asked for and deliberately NOT built** — see Known
simplifications for why (a ~225MB model download).

**Real virtual try-on ("Add Formal Attire") — an earlier decision to
rule this out was later reversed.** The manual overlay/heuristic system
(a vector illustration or uploaded PNG, dragged/aligned by hand) has
been **removed entirely** and replaced by a genuine AI image-generation
pipeline: the user supplies their own free-tier API key for one or more
AI providers (Gemini, OpenRouter, Hugging Face, etc., managed in the
**AI Providers** settings panel), and clicking **Add Formal Attire**
sends the uploaded photo to a real generative image-editing model, which
returns the same person actually wearing formal attire — not an
overlay. This works without a dedicated backend server because the
native-bridge pattern this app already had for Save Job (Electron IPC /
Android's `AndroidBridge`) solves the CORS/key-exposure problem that
would otherwise require one. See `js/modules/modelProviders.js`'s own
top-of-file comment and the Architecture/Known-simplifications sections
below for the full write-up.

## How to run
Just open `index.html` in a browser. No install/build needed, no
internet needed either — except for "Remove Background" (Step 2), which
fetches its AI model from a CDN on first use only.
(A single-file bundle also exists for quick mobile testing — see
"Standalone bundle" below.)

**A Windows desktop installer also exists** (Electron) — see "Desktop
app (Electron)" below — so it can be installed and run without opening
a browser at all, for print-shop staff who just want a normal-looking
Windows program.

**An Android APK also exists** — see "Mobile app (Android)" below —
same "installed app, no browser" idea, for a phone/tablet at the
counter. Two build paths documented there (Capacitor+Gradle is the
normal one; a hand-built no-Gradle path is what actually produced the
shipped APK, due to a real build-environment bug on this dev machine —
worth reading before assuming Path A "should just work").

**If "Save current job" (Step 5) fails outright** ("could not save —
storage is being blocked"), it's almost always because the file was
opened directly (double-clicked, `file://` in the address bar) rather
than served — some browsers refuse to grant `localStorage` to `file://`
pages at all. Serving it from any local static server (e.g.
`php -S 127.0.0.1:8000` from this folder, or equivalent) fixes it. Step
5 now shows a specific warning banner + the real browser error the
moment this is detected, instead of only failing silently at Save —
see the Save Job bullet under Known simplifications.

## Architecture
- `index.html` — app shell (header, step rail, canvas stage, inspector
  panel). Loads Fabric.js from `vendor/fabric-6.4.3.js` (self-hosted,
  not a CDN) before `canvasEditor.js`, as a plain global `<script>` —
  unlike bg-removal (optional, loaded on first *use* from a CDN), Fabric
  is core to Step 2 and always needed, so it's loaded like the app's own
  scripts, and needed to work offline too. The header's `.brand-mark` is
  the user-supplied logo at `assets/logo.png` (128×128, downscaled from
  their original upload); `.brand-name` uses a CSS gradient-clip
  (`background-clip: text; color: transparent`) across `--logo-blue`/
  `--logo-orange` (`css/styles.css`) so the "PrintPix Rush ID" wordmark
  matches the logo's own two colors instead of the app's indigo/violet
  brand accent.
- `vendor/` — self-hosted third-party libraries, checked into the repo
  instead of fetched from a CDN, so the app works with no internet:
  `fabric-6.4.3.js` (Fabric's UMD/global build) and
  `jspdf-4.2.1.umd.min.js` (jsPDF's UMD build — NOT the ESM build; see
  the comment in `printExport.js`'s `loadJsPDF()` for why the ESM build
  doesn't work standalone in a browser: it has an unbundled
  bare-specifier import for a Babel helper that only resolves under a
  bundler/import map). Used to also hold the AI Upscale stack
  (TensorFlow.js + UpscalerJS + its model, ~2.3MB) — removed along with
  `aiUpscale.js` when that feature was replaced by `autoEnhance.js`
  (plain Canvas 2D, no vendor dependency at all).
- `css/styles.css` — full design system (tokens, components)
- `js/app.js` — entry point, wires up step-rail navigation, calls each
  module's `.init()` in a specific order (see comment in the file — some
  modules must register event listeners before `PageSetup.init()` /
  `IdSize.init()` / `PrintExport.init()` fire their first synchronous
  change event)
- `electron/main.js` — Electron main process for the optional desktop
  installer; loads this same `index.html` in a native window, no changes
  to the web app itself. See "Desktop app (Electron)" below.
- `js/modules/pageSetup.js` — paper size + orientation state. Presets:
  2R/3R/4R/5R/6R/8R (standard PH photo-paper sizes), A4, Letter, Legal,
  plus **Custom size** (own width/height in inches, entered in a row
  that only shows when 'custom' is selected) — same "hidden until
  selected" pattern as Step 3's custom ID size row.
- `js/modules/idSize.js` — Step 3: a *list* of ID sizes added to the
  sheet, each with its own quantity, plus the name-tag overlay (text +
  color). The size-grid + quantity input are just a picker — nothing is
  added to the sheet (or reflected in `idsize:change`) until "Add to
  sheet" is clicked, so mixing sizes (e.g. 2×2 *and* 1×1 on one sheet)
  works without one choice wiping out the other.
- `js/modules/faceFitHeuristic.js` — a small, trimmed survivor of the old
  `attireRenderer.js` (deleted along with the rest of the manual attire
  system — see below). Keeps only `computeFaceFitCrop()`, reused by the
  "Auto-fit face" one-shot button; has nothing to do with attire anymore.
- `js/modules/canvasEditor.js` — the interactive Edit workspace, built on
  Fabric.js. **Important model change**: the workspace represents *one
  fixed-size reference ID cell* (500×500, always square), not the whole
  physical sheet — see "Editing model" below for why. The photo is a
  single Fabric.Image object (select/drag/resize come free from Fabric's
  built-in controls); "crop" is just panning/resizing within the
  workspace's fixed bounds, since Fabric's export only rasterizes what's
  inside them. Broadcasts a `photo:change` CustomEvent with the
  flattened photo (not the background — see below) on every object
  move/scale/modify. There is no longer a second, independently-
  draggable "attire" Fabric object, no Layers list, and no
  `setAttireObject()`/`alignAttireToPhoto()`/etc. — that whole system
  was removed (see "Real virtual try-on" above); a generated formal-
  attire result replaces the photo's own pixels via `setEnhancedPhoto()`
  (same mechanism Auto Enhance already used), so there's nothing left to
  separately position/resize. Also owns the **Eraser**
  (`setEraserMode()`/`handleEraseStroke()`) — a plain brush tool, NOT
  AI/content-aware fill; see Known simplifications for exactly what it
  does and doesn't do.
  **Undo/Redo**: `historyStack` of full `getSaveState()` snapshots
  (capped at `MAX_HISTORY = 20`), not per-field diffs — simplest thing
  that's provably correct given `loadState()` already exists for
  Save/Recopy. `pushHistory()` fires centrally from `setPhotoObject()`
  plus a handful of explicit call sites (background changes,
  `autoFitFace()`, `deleteSelected()`). `undo()`/`redo()` call
  `loadState(snapshot, {quiet:true})` — the `quiet` option skips the
  "restored from a saved job" status message and does NOT reset the
  history stack — then dispatch `editstate:restored` (detail: the
  restored `getSaveState()`) so `bgRemoval.js` can re-sync its own
  swatch DOM, the same event Save/Recopy's Recopy path already needed.
  Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) are wired globally, not just via the
  two toolbar buttons. **Delete selected layer** (`deleteSelected()`)
  removes the photo entirely, back to the empty drop-zone.
- `js/modules/modelProviders.js` — the AI provider registry/data layer
  for **Add Formal Attire**. `PROVIDER_PRESETS` defines each provider's
  (Gemini, OpenRouter, Hugging Face, Pollinations, Qwen, Groq, OmniRoute,
  Custom) test/edit request builders and response parsers. CRUD over
  saved provider configs in `localStorage['printpixRushId.providers']`.
  `testProvider(config)` does a real "list models" (or minimal probe)
  call and records `lastTestStatus`. `pickCandidates()` implements
  "Fill First": tested-working, image-edit-capable providers, free
  models sorted before paid ones, as a flat ordered list —
  `aiAttireAssistant.js` tries them one at a time until one succeeds.
  `detectPresetFromKey()` auto-selects the right provider from the shape
  of a pasted API key (Gemini/OpenRouter/HuggingFace/Groq key prefixes).
  `autoTestUntested()` (called from `init()`) fire-and-forget tests any
  saved provider that has a key but hasn't been tested yet, so a
  provider added last session shows a correct pass/fail badge without
  the user manually re-testing it. All real HTTP (test + edit) goes
  through `callHttp()`, which routes through a native bridge when
  available (Electron's `ai-provider-call` IPC handler, or Android's
  `AndroidBridge.callProvider`) — see "Architecture: how AI provider
  requests actually get made" below — falling back to plain `fetch()`
  otherwise (browser-tab testing only; not subject to CORS issues there
  either for most providers, but no guarantee).
- `js/modules/aiAttireAssistant.js` — the actual "Add Formal Attire"
  pipeline: `generateFormalAttire(photoImageEl, gender, onProgress)`
  builds a male/female-specific edit prompt, loops through
  `ModelProviders.pickCandidates()` calling `ModelProviders.callEdit()`
  for each until one succeeds, decodes the result into an `Image`, and
  aggregates every attempt's error into one message if all candidates
  fail (never a silent/generic failure). `onProgress(status)` lets the
  UI show "Trying <provider>…" per attempt.
- `js/modules/formalAttireCommand.js` — the **Command Options** UI in
  Step 2: a Male/Female gender toggle plus one **Add Formal Attire**
  button (replaced the old "Formal attire" toggle + illustration/upload/
  opacity/align controls entirely). Calls
  `AiAttireAssistant.generateFormalAttire()` then
  `CanvasEditor.setEnhancedPhoto()` with the result. Listens to both
  `upload:change` (a brand-new upload) and `job:applied` (a restored
  job) to enable/disable itself correctly — see the `job:applied`
  bullet below for why both are needed.
- `js/modules/providerSettings.js` — the **AI Providers** modal (header
  button, top-right): add/test/delete provider entries against
  `ModelProviders`' storage, a preset dropdown wired to show/hide the
  Base URL field only for presets that need one (`needsBaseUrl`), and a
  key-input listener that calls `ModelProviders.detectPresetFromKey()`
  to auto-select the right provider dropdown option as the user pastes
  a key.
- `js/modules/livePreview.js` — the Live Preview pane: packs every added
  Step 3 size/quantity onto the sheet with a greedy shelf-packing
  algorithm (see its own comment in the file), draws the chosen
  background + the flattened photo composite into each cell, plus
  cutting guides (toggleable) and the watermark. Mirrors state via
  `pagesetup:change`, `photo:change`, `idsize:change`, `printlayout:change`.
  No manual "generate preview" step — always live, but shows nothing
  until at least one size has been added in Step 3. Has its **own**
  zoom control (`previewZoom`, independent of CanvasEditor's workspace
  zoom in Step 2) — same "grow the canvas element, let `.stage-scroll`
  handle panning" technique as Step 2's zoom.
  `packEntries()` tracks explicit **shelves** (`{y, height, width,
  cells}`), one per packed row, and centers each shelf independently
  within the sheet's usable width, so mixed-size rows (e.g. a row of
  1×1s under a row of 2×2s) each look centered on their own, not just
  the bounding box of the whole packed stack. This is NOT a manual
  toggle/button — there is no "Align Center" control in the UI, it's
  simply how the always-live layout is computed on every redraw. (An
  earlier version of this doc, and the in-app Help Guide until a later
  audit pass fixed it, incorrectly described this as a button — real
  content bug, corrected; don't reintroduce it.)
- `js/modules/bgRemoval.js` — "Remove background" button + background
  swatches (solid colors, custom color, custom image). Uses
  `@imgly/background-removal` loaded via **dynamic import from a CDN**
  (`https://esm.run/@imgly/background-removal`) the first time it's used
  — needs internet on first use only (downloads a small WASM model, then
  it's browser-cached). Shows a real download percentage via the
  library's `progress: (key, current, total)` callback into a
  `.progress-bar` element (see Design system) — the percentage is
  per-asset, not one smooth global counter, since there are multiple
  files downloading; once downloads finish there's no further signal for
  the inference itself, so the hint switches to "Processing…" so it
  doesn't look stuck at 100%. Background itself is applied as CSS on
  `#sheetFrame` (behind the transparent Fabric canvas), not drawn inside
  Fabric — see "Editing model" below for why.
- `js/modules/autoEnhance.js` — "Auto Enhance" button in Step 2.
  Replaces the old `aiUpscale.js` (TensorFlow.js + UpscalerJS) — that
  pipeline kept being unreliable in real use even after a WebGL-crash
  fix (see the old version's history: 3000×4000 photos reliably crashed
  TF.js's WebGL backend with "Failed to compile fragment shader", and
  once that happened the WebGL context stayed broken for the rest of
  the page's life). Auto Enhance is deliberately the opposite kind of
  implementation: plain Canvas 2D `getImageData`/`putImageData` pixel
  math, synchronous, no model, no WebGL, no download — nothing that can
  hang or leave the page in a broken state. Pipeline, in one pass over
  the pixel data: (1) auto-contrast via a **single luminance-based**
  0.1%/99.9% percentile histogram stretch applied identically to R/G/B
  — deliberately NOT independent per-channel stretching, which an
  earlier version did and which testing showed could shift color
  balance strongly (a near-neutral-gray pixel came out visibly
  blue-tinted) on images with a narrow per-channel tonal range; these
  are ID photos of people's faces, so a predictable, hue-preserving
  contrast boost matters more than a fancier per-channel "auto white
  balance"; (2) a mild saturation boost (pixels pushed away from their
  own average by a small factor); (3) a light unsharp-mask sharpen (3×3
  box blur subtracted back off the original). Does NOT change pixel
  dimensions, so `CanvasEditor.setEnhancedPhoto()` (renamed from
  `setUpscaledPhoto()`, same scale-preserving logic — reused as-is,
  since it degrades to a no-op adjustment when dimensions match) is a
  closer-to-plain swap than the old upscaler needed. Since this blocks
  the main thread for the actual pixel loop, `handleEnhance()` yields
  once via `setTimeout` (NOT `requestAnimationFrame` — rAF callbacks are
  suspended in backgrounded/hidden tabs and would hang this step
  forever if the user alt-tabbed away right after clicking; caught this
  exact hang during testing) between setting the "Enhancing…" UI state
  and running the pixel loop, so the loading state actually paints
  first instead of the button looking dead on a large photo.
### Architecture: how AI provider requests actually get made
Real HTTP calls (`testProvider`/`callEdit` in `modelProviders.js`) go
through a native bridge when available, exactly mirroring the pattern
this app already used for Save Job:
- **Desktop**: `window.electronAPI.callProvider(request)` →
  `electron/preload.js`'s bridge → `ipcMain.handle('ai-provider-call', ...)`
  in `electron/main.js` makes the actual request from Node's own
  `http`/`https` modules (picked by the URL's protocol), not subject to
  browser CORS at all.
- **Mobile**: `window.AndroidBridge.callProvider(requestId, method, url,
  headersJson, body)` (fire-and-forget, like `saveFileAs`/`writeToUri`)
  → `MainActivity.java`'s `AndroidBridge.callProvider()` makes the
  request on its own background `Thread` via `java.net.HttpURLConnection`
  (never the UI thread — a generation call can take several seconds),
  then posts the result back to JS via
  `webView.evaluateJavascript("window.__androidProviderCallback(id, ok,
  status, body)")`, matched to the original call through `requestId` —
  same request/callback pattern as the file-save bridge.
- **Neither bridge present** (plain browser tab): falls back to a direct
  `fetch()` — used for quick Browser-pane testing, not the shipped apps.

Both bridges base64-encode a response whose `Content-Type` starts with
`image/` (some providers return raw image bytes instead of JSON) and
pass plain text through otherwise; `callHttp()`'s own
`JSON.parse`/`looksLikeBase64()` fallback on the JS side handles either
shape uniformly regardless of which bridge produced it.

API keys themselves still live in plain `localStorage` (same trust
model as saved jobs, see the Security note below) — the bridge only
solves CORS/reliability/background-thread execution, not key storage.
- `js/modules/printExport.js` — Step 4: sheet margin, cutting-guide
  visibility, tight packing (no gap between cells), and watermark/
  proofing overlay. Emits `printlayout:change`. "Print" and "Export PDF"
  both open a shared **Print Preview modal** first (built from
  `LivePreview.renderToCanvas()` at 300 PPI) — the modal itself offers
  both actions regardless of which button opened it, so both flows get a
  WYSIWYG confirmation step before committing. PDF export embeds that
  raster via jsPDF, loaded on demand from `vendor/` (self-hosted, lazily
  injected as a `<script>` tag on first export rather than upfront —
  same "don't pay for it until you use it" timing as bgRemoval.js, just
  from a local file instead of a CDN now). Printing
  goes through a hidden same-origin `<iframe>` holding just the rendered
  image, with an injected `@page` CSS rule matching the physical sheet
  size (the modal's "print at actual size" toggle) so the print dialog
  doesn't silently scale the ID photos to a wrong physical size.
- `js/modules/saveRecopy.js` — Step 5 ("Save Job"): saves the whole
  current job (page setup + ID size entries/name tag + print layout +
  the photo edit) both as a record in
  `localStorage['printpixRushId.jobs']` (the in-app list) **and** as a
  real standalone .json file, via whichever native save path the
  current platform actually has (see "File saving priority order"
  below) — this is what makes a job genuinely portable: move the file
  via USB and open it on another computer's/phone's copy of this app
  (via **Step 5's own "Open" button** on a saved job, "Import job
  .json", or the startup gate's "Open Job") to restore it exactly.
  Unlike the other step modules it emits nothing (except `job:applied`,
  see below) — it only *reads* `getState()`/`getSaveState()` from the
  other modules on Save, and *pushes* state back in via their
  `setState()`/`loadState()` on Open/Import.
  PageSetup/IdSize/PrintExport each have a `getState()`/`setState()`
  pair; CanvasEditor has `getSaveState()`/`loadState()`;
  BgRemoval has a cosmetic `syncUI()`, since it owns its own swatch DOM
  but not the underlying state (CanvasEditor does). `applyJob()`, `captureCurrentJob()`,
  `loadJobs()`, and `saveCurrentJob()` are exported for reuse by
  `jobLifecycle.js` — see below. `applyJob()` dispatches a `job:applied`
  event when it finishes, regardless of caller (Open, Import, or
  jobLifecycle.js's New/Open Job).
  **File saving priority order** (`saveJobToFile()`), platform-specific
  bridge first, generic web APIs as fallback so the same code still
  works when run as a plain browser tab:
  1. **Electron** (`desktop/` only) — `window.electronAPI.saveJobFileAs`
     (from `electron/preload.js`), which shows a real native Save dialog
     via Electron's own `dialog`/`fs` IPC. Added because the browser's
     own File System Access API below didn't reliably show a dialog
     under Electron's `file://` origin in real testing — see "Desktop
     app (Electron)" below for the fuller writeup; this exists to route
     around that gap rather than keep depending on an API that didn't
     behave the same as in a real Chrome tab.
  2. **Android WebView** (`mobile/` only) — `window.AndroidBridge.saveFileAs`
     (from `MainActivity.java`), which opens Android's Storage Access
     Framework "Save as" picker — a real folder-choice dialog, not a
     fixed location. Added because a bare WebView has no download
     manager at all — see "Mobile app (Android)" below. (An earlier
     version of this bridge wrote silently to the Downloads folder via
     `MediaStore` with no picker at all; real-device feedback pointed
     out that didn't satisfy the actual ask, a genuine "choose where"
     dialog, so it was replaced.)
  3. **Browser** (no Electron/Android bridge present) —
     `window.showSaveFilePicker` (Chrome/Edge only).
  4. **Anything else** (Firefox/Safari, or step 3 unsupported) — a plain
     forced download via `downloadJson()`.
  A job's "linked file" for the saved-jobs list's silent re-save is
  either a `FileSystemFileHandle` (browser path) or a plain absolute
  path string (Electron path — `dialog.showSaveDialog` returns a path,
  not a handle object; `handleDisplayName()` normalizes either into a
  filename for display). Kept in an in-memory `Map` (`fileHandles`,
  keyed by job id) — NOT persisted across a page reload (would need
  IndexedDB for the browser case, plus a permission re-grant anyway, for
  very little practical gain). Within one session, the saved-jobs list's
  **Save** button reuses that handle/path to overwrite the exact same
  file silently; after a reload, the first Save on a job just re-prompts
  for a location once more, same as a first save. That Save button is a
  real "Save" (not "Save As"): it captures whatever is on the workspace
  *right now* and overwrites that job's list entry (same id) and linked
  file, guarded by a confirm modal (`#confirmSaveJobModal`) — clicking
  Save on the wrong list entry while working on something unrelated
  would otherwise silently clobber that job's stored data. Each list
  entry's **Open** button routes through `JobLifecycle.requestOpenJob()`
  (not `applyJob()` directly) so it gets the same unsaved-changes
  confirm guard "Create New Job" already has.
  `downloadJson()` (the last-resort fallback path) delays
  `URL.revokeObjectURL()` by 2s instead of calling it synchronously
  right after `a.click()` — the old immediate-revoke pattern is a known
  real-world cause of truncated/empty downloaded files in some browsers,
  since the browser's download pipeline reading the blob isn't
  necessarily finished just because `.click()` has returned.
- `js/modules/jobLifecycle.js` — the startup gate (a modal shown the
  instant the app loads, before any panel is usable, offering **"New
  Job"** or **"Open Job"**), the **"Create New Job"** button that stays
  in the header once inside the workspace, and (as of the "Open" button
  on Step 5's own list, see saveRecopy.js above) the guard behind that
  button too. All three paths that hand off to `SaveRecopy.applyJob()`
  — New, the startup gate's Open, and Step 5's own Open — reuse the
  exact same restore path Recopy/Import already use, rather than
  teaching every module its own separate reset method. New's
  `BLANK_JOB` template is hand-built once and deep-cloned per use.
  Both "Create New Job" and Step 5's "Open" button share one **dirty
  flag** — any `pagesetup:change`/`photo:change`/`upload:change`/
  `idsize:change`/`printlayout:change` sets it, only `job:applied`
  clears it — and one confirm modal (`#confirmNewJobModal`), reused for
  both triggers via `openConfirmModal(kind, targetJob)`: the title,
  body text, and Save button label swap by `kind` ("new" vs "open"),
  and `pendingConfirm` remembers which action (and which job, for
  "open") Discard/Save & ... should actually run. `requestOpenJob(job)`
  is the exported entry point Step 5's Open button calls — it skips the
  modal entirely when the workspace isn't dirty. Not a real diff —
  undoing back to an unchanged state still counts as "unsaved" — see
  Known simplifications.
- `js/modules/helpGuide.js` — the "?" button in the header (top-right)
  opens a static reference modal (`#helpGuideModal` in `index.html`) —
  no state, just open/close, same backdrop-click-to-close pattern as
  Print Preview. Content is plain HTML (`.guide-section` blocks) written
  directly in the modal body, not generated — update it by hand there
  whenever a feature changes.

### Editing model: one cell, not one sheet
The old version rendered the *whole physical sheet* in the Edit pane,
with the photo auto-fit into it — fine when there was one uniform grid.
It stopped making sense once a sheet can hold *multiple different* ID
sizes (Step 3): there's no single "contain-fit to the sheet" framing
that works for a 1×1 cell and a 2×2 cell at once. So the Edit workspace
is now a fixed 500×500 reference frame — always square, matching
1×1/1.5×1.5/2×2 — that the user frames one photo into once;
Live Preview/PDF tile copies of that same composition into every cell of
every added size. Passport/custom non-square sizes still contain-fit the
composite at render time rather than getting pixel-identical framing —
no distortion, just not a custom crop per aspect ratio.

Background stays *outside* Fabric on purpose: it's CSS on `#sheetFrame`
behind a transparent Fabric canvas, so `photo:change`'s flattened image
never has a background baked in at the fixed 500×500-ish working
resolution — LivePreview/PDF export redraw the background per cell at
each cell's *actual* pixel size instead, for better quality at very
different cell sizes.

Save/Recopy for the photo edit hand-rolls transform + data-URL
serialization instead of Fabric's `canvas.toJSON()`/`loadFromJSON()` —
`toJSON()` would capture each object's *original* image src, which for
an uploaded photo is a `blob:` URL that gets revoked right after load
and is useless on restore. Snapshotting each object's current pixels to
a data URL at save time sidesteps that.

### Custom events (how modules talk to each other)
- `job:applied` — fired by `saveRecopy.js`'s `applyJob()` once every
  module has finished restoring (Recopy, Import, or jobLifecycle.js's
  New/Open Job). No detail payload. jobLifecycle.js listens to clear the
  "unsaved changes" dirty flag; `formalAttireCommand.js`/`autoEnhance.js`
  also listen to re-enable their own button (`bgRemoval.js`'s `syncUI()`
  does the same for Remove Background) — found as a real bug during
  testing: those three buttons only ever enabled via `upload:change` (a
  *brand-new* upload), never on a restored job (autosave/Open Job/
  Recopy/Import don't fire that event — the original `File` object
  doesn't survive a save/reload), so all three stayed permanently
  disabled after "Continue where you left off" despite a photo clearly
  being loaded.
- `pagesetup:change` — fired by pageSetup.js whenever paper size/orientation
  changes. detail: `{ key, label, orientation, widthIn, heightIn }`
- `photo:change` — fired by canvasEditor.js on every object move/scale/
  modify. detail: `{ image, background }` — `image` is the flattened
  photo (an `HTMLCanvasElement`, or `null` if no photo), `background` is
  `{ mode, color, image, imageDataUrl }`. No more `zoom`/`attire`/
  `faceFit` fields — those are baked into `image` upstream now.
- `upload:change` — fired by canvasEditor.js when a *new* file is loaded
  (used by bgRemoval.js/autoEnhance.js/formalAttireCommand.js to reset
  their own UI state — see the `job:applied` bullet above for why a
  *restored* job needs its own separate listener for the same thing)
- `idsize:change` — fired by idSize.js whenever the size-entry list or
  name tag changes. detail: `{ entries, nameTag }` where `entries` is
  `[{ widthIn, heightIn, quantity }, ...]` (empty until something's been
  added) and `nameTag` is `{ enabled, text, color }`. livePreview.js is
  the only consumer today.
- `printlayout:change` — fired by printExport.js whenever margin,
  cutting-guide visibility, tight packing, or the watermark changes.
  detail: `{ marginIn, watermark, showCuttingGuide, tightPacking }` where
  `watermark` is `{ enabled, text }`. livePreview.js is the only consumer
  today.

### Design system (css/styles.css)
- Brand/interactive accent: indigo→violet gradient (`--brand` / `--brand-2`)
- Registration red (`--registration`) is reserved for the decorative
  print/crop-mark corners ONLY — never used on buttons/interactive
  elements (so it never reads as an "error" color)
- Each step in the step rail has its own accent color (blue/violet/amber/
  teal/rose) via `.step-icon-*` classes, for quick visual scanning
- Small reusable icon classes: `.icon-chip` (inline colored icon, no bg),
  `.panel-icon` (26px tile with bg, for panel titles)
- Toggle switches: `.switch` / `.switch-track` / `.switch-thumb` — note
  `.switch-track` has `pointer-events: none` so clicks pass through to
  the actual `<input>` underneath; don't remove that, it was a real bug
  (blocked clicks in real browsers, not just automated testing)
- `.job-list` / `.job-item` / `.icon-btn` (originally built for Step 5's
  saved-jobs list) are reused as-is for Step 3's added-size-entries list
  — same visual pattern, two different containers/IDs, no new CSS needed
- `.modal-overlay` / `.modal-box` (introduced for Print Preview, Step 4)
  — `position: fixed; inset: 0`, closes on backdrop click or the ×
  button. Now also used by the startup gate, "Create New Job" confirm,
  "Save" overwrite confirm, and the Help Guide — the standard pattern
  for any dialog/overlay in this app.
- `.progress-bar` / `.progress-bar-fill` — a small reusable component for
  "this button triggers a real download/computation" feedback. Used by
  bgRemoval.js (`removeBgProgress`), autoEnhance.js's `enhanceProgress`
  (which doesn't have real percentage data to show, unlike a model
  download — it just jumps to ~55% then 0% as a lightweight "something
  is happening" indicator, not a dishonest fake percentage), and
  formalAttireCommand.js's own progress bar while a generation request
  is in flight.

### Known simplifications (be upfront about these, don't silently "fix"
### them into looking more sophisticated than they are)
- **Offline support** covers the core flow (edit, arrange, PDF export,
  print) but not "Remove Background" — that still needs internet to
  download its AI model from a CDN on first use. Self-hosting it would
  mean identifying and downloading every asset file it fetches (ONNX
  model + WASM runtime, often tens of MB total) and configuring the
  library's `publicPath` to point at them — deliberately out of scope
  for now; ask before taking this on, since it's a real download.
- **Auto-Fit Face** is NOT real face detection — it's a crop heuristic
  (crops the bottom ~28% off the photo, assumes the head is in what's
  left), applied as a *one-shot* snap (a button, not a live toggle) that
  the user can then fine-tune by dragging. Labeled as approximate in the
  UI hint text on purpose.
- **Add Formal Attire depends entirely on the user's own configured AI
  provider(s)** — there is no built-in/guaranteed-working provider. If
  no provider is added, or none tested successfully, the button fails
  with a clear message pointing at **AI Providers** rather than silently
  doing nothing or degrading to an old-style overlay (that system no
  longer exists at all). Generation quality/speed/cost are entirely the
  chosen provider's, not something this app controls — this app just
  sends the photo + a prompt and displays whatever image comes back.
  **Pollinations** (pre-registered, no key needed) can validate a
  provider Test/model-list, but its actual image-edit endpoint needs a
  *publicly hosted* image URL, which this no-backend app cannot supply
  — its `buildEditRequest()` throws an immediate, honest error instead
  of attempting a call that's guaranteed to fail silently. **Hugging
  Face** image-edit routing to third-party partners (fal-ai/replicate/
  wavespeed) is best-effort — each partner needs its own undocumented
  request shape when called via raw HTTP, so a specific model may not
  work even though the provider's own key/connection test passes. See
  `modelProviders.js`'s own top-of-file comment for the full per-
  provider write-up (what's confidently correct vs. best-effort).
- **Auto Enhance** is auto-contrast + saturation + sharpen — it does NOT
  add resolution or recover detail that was never captured, unlike the
  AI Upscale feature it replaced. Quality gains are modest and
  predictable (levels/color/crispness), by design — see the
  `autoEnhance.js` bullet above for why it was built this way.
- **Eraser** is a plain brush — NOT content-aware fill / AI inpainting.
  Drawing a stroke punches that area to fully transparent (canvas
  `destination-out` compositing on a rasterized mask of the stroke), the
  same way a Photoshop eraser behaves on a layer with nothing behind it
  — the background color/checkerboard shows through the hole, nothing
  gets "filled in". Committing a stroke also flattens the photo's
  current crop/position into a new bitmap at `EXPORT_MULTIPLIER`
  resolution (same quality tier as PDF/print export) — further
  drag/resize after erasing moves that flattened result, not the
  original source image, and there's no undo for a stroke once made
  (only for the *result* — undoing the whole erase via Ctrl+Z works
  fine). No model, no download — this is the fast/simple tool that
  shipped instead of the AI Eraser below, per an explicit "simple lang"
  request. A dashed circle overlay tracks the pointer at the brush's
  real on-canvas size (`eraserCursorCircle` in `canvasEditor.js`) so the
  brush's reach is visible while erasing — see `withNeutralZoom()`'s
  comment for a real bug this surfaced: flattening a stroke while the
  workspace wasn't at exactly 100% zoom used to shrink/crop the result,
  since `toCanvasElement()` scales its output by the canvas's *current*
  zoom and backing resolution, not a fixed reference size.
  **The cursor circle itself had a second, separate real bug on first
  ship**: it was correctly added to the canvas with correct left/top/
  visible values on every pointer move (confirmed via direct object
  inspection), yet never actually appeared on screen. Root cause: Fabric
  canvases default to `skipOffscreen: true` (viewport culling for
  performance), and the culling check (`isOnScreen()`) reads an object's
  **cached** `aCoords` bounding box, not its live `left`/`top` —that
  cache is only refreshed by `setCoords()`, which plain `.set()` does
  NOT call. The circle's `aCoords` stayed frozen at its initial
  off-canvas spawn position (-1000,-1000) forever, so `isOnScreen()`
  always returned false and the circle was silently culled on every
  render, no matter how many times its actual position was updated.
  Fixed by calling `.setCoords()` right after every `.set({left, top})`
  / `.set({radius})` on the circle (`handleEraserPointerMove()` and
  `updateEraserCursorRadius()`). Caught this by directly pixel-sampling
  the live on-screen `.lower-canvas` element (with a forced synchronous
  `fabricCanvas.renderAll()`, bypassing `requestRenderAll()`'s
  `requestAnimationFrame` batching) rather than trusting object-property
  state alone — the first verification pass only checked the latter and
  wrongly reported this as working. Worth remembering for any future
  Fabric object whose position is updated via `.set()` outside of a
  user drag/transform (which auto-refreshes coords on its own): call
  `.setCoords()` afterward, or it may silently never render once it's
  moved from wherever it was first placed.
- **AI Eraser** (true content-aware inpainting / object removal that
  reconstructs what should be behind the erased area) was asked for and
  is NOT implemented, purely due to size: a working client-side
  inpainting model (LaMa, exported to ONNX) is ~198MB by itself, plus
  ~27MB for the onnxruntime-web runtime to execute it — roughly 225MB
  combined, versus under 2MB for everything else this app self-hosts
  (Fabric, jsPDF). It's technically feasible (there's a real, working
  ONNX export of LaMa on Hugging Face)
  but was deliberately deferred given that size. Revisit if/when that
  download size is explicitly OK.
- **Reference frame is always square (1:1)**, not adaptive to whichever
  Step 3 size is currently selected/added — see "Editing model" above.
  Keeps Step 2 fully independent of Step 3's state (no ordering
  dependency between "frame your photo" and "pick your sizes").
- **Multi-size packing (Step 3)** is greedy shelf-packing (tallest
  entries first, wrap rows, stop when nothing more fits), not an
  optimal bin-packer — mixing very different sizes can leave some usable
  sheet space unused. "Tight packing" (Step 4) removes the gap between
  cells to fit more per sheet, at the cost of needing to cut precisely
  along the guide line (no scissors margin between copies).
- **Quantity** is still single-sheet only: Live Preview packs as many
  cells as fit (across every added size) and only draws a photo into
  that many. Requested copies beyond what fits on one sheet are simply
  not shown — there's no multi-sheet pagination.
- **Name tag** color is now customizable (text stays customizable too),
  but band height/position are still fixed (bottom ~16% of each cell).
- **Undo/Redo** snapshots the *entire* editable state on every change
  (capped at the last 20), not per-field diffs — simple and provably
  correct (it's the same serialization Save/Recopy already relies on),
  but means every undo step is a full photo+background snapshot in
  memory, not a lightweight command log. Fine at this app's scale
  (single active job, capped history), would need rethinking for a
  much bigger editable document.
- **Delete selected layer** removes the photo entirely (back to the
  empty drop-zone) rather than offering a lighter-weight "clear crop but
  keep the file" — reflects that there's no meaningful "empty but keep
  the photo" state once Fabric no longer holds the object.
- **"Unsaved changes" (Create New Job guard)** is a conservative dirty
  flag, not a real diff against the last saved/loaded state — any edit
  event sets it, and it only clears on `job:applied` (New/Open/Recopy/
  Import). Undoing every change back to exactly where you started still
  shows as "unsaved" and will still prompt to save. There's also no
  `beforeunload` guard — closing or refreshing the browser tab entirely
  loses unsaved work with no warning; the guard only covers the
  in-app "Create New Job" button, per what was actually asked for.
- **Watermark (Step 4)** is a single centered diagonal text overlay, not a
  repeating tile pattern — good enough to mark a proof copy, not a
  production anti-copy watermark.
- **Print** goes through `window.print()` on a hidden iframe with an
  injected `@page` CSS size rule — Chrome/Edge honor this and default the
  print dialog to the correct physical paper size; Firefox/Safari are
  less consistent about it, so the printer's paper size may still need
  to be set manually there (the modal's hint text says so). There's no
  programmatic way from JS to force a specific physical printer's
  settings — real "print setup" (which printer, its own paper tray,
  color settings) is still the OS/browser's native print dialog, which
  `window.print()` opens as usual. **`mobile/` does not use this path at
  all** — a bare `android.webkit.WebView` doesn't implement
  `window.print()` (no default, no fallback), so the Print Preview
  modal's Print button routes through `window.AndroidBridge.printImage`
  instead when present, which opens Android's own `PrintManager` dialog
  — see "Mobile app (Android)" below. Real printers/print services may
  not honor the exact custom media size requested there either (same
  caveat as the browser path, just via Android's print framework
  instead of CSS `@page`) — "Save as PDF" (built into Android) is the
  one target guaranteed to respect it.
- **PDF export** rasterizes the sheet at a fixed 300 PPI via
  `LivePreview.renderToCanvas()` and embeds that single raster image as
  one PDF page — it's an image-based "print this sheet" export, not a
  vector PDF, and it does not paginate across multiple sheets even if
  quantity would need more than one. Export quality is capped by the
  resolution of the uploaded source photo.
- **Save Job (Step 5)** keeps a local list in plain `localStorage` — no
  encryption, and no cap on how many jobs you save until the browser
  quota (typically ~5-10MB) is hit. The photo is downscaled before being
  stored (1600px longest edge) to keep jobs reasonably sized — this
  includes an AI-generated Add Formal Attire result, since it replaces
  the photo's own pixels rather than being stored separately. A restored
  job's original `File` object doesn't survive the round trip (only the
  flattened image does), so "Remove Background" needs a fresh photo
  upload to run again after opening a job — the photo's *position and
  scale* do survive, though (hand-rolled transform serialization, see
  "Editing model" above), so a restored job is still fully editable, not
  frozen into one flat picture.
  **True cross-computer portability** is most reliable on `desktop/`
  (Electron's own native Save dialog, see "File saving priority order"
  above and "Desktop app (Electron)" below — always available in the
  packaged app) and `mobile/` (Android's own Storage Access Framework
  "Save as" picker via the AndroidBridge, see "Mobile app (Android)"
  below — a real folder-choice dialog, same idea as the other two).
  Running as a plain browser tab falls back to the File System Access
  API (`showSaveFilePicker`, Chrome/Edge only) or, on Firefox/Safari, a
  plain forced download with no native "choose a folder" dialog and no
  in-place re-save (the saved-jobs list's Save button just re-downloads
  a fresh copy there, confirm dialog and all, rather than truly
  overwriting one file) — a real, unavoidable browser-support gap in
  that fallback tier specifically, not a bug.
  **"Recopy" and the plain "download" action were removed** from the
  saved-jobs list, replaced by "Save" (overwrites the linked file and
  list entry with whatever is on the workspace right now) and **"Open"**
  (loads that job back into the workspace, added after testing showed
  "Open Job" only existing at the startup gate wasn't enough — see
  jobLifecycle.js's `requestOpenJob()` above). **Save failures are
  diagnosed, not just reported
  as failed**: `saveRecopy.js`'s `describeStorageError(err)` branches on
  the exception's `name` — `QuotaExceededError` gets a "delete some
  saved jobs" message, `SecurityError` gets a message specifically
  calling out the most common real-world cause (the app opened directly
  as a `file://` page — double-clicked instead of served — which some
  browsers refuse local storage to; also happens in strict
  private-browsing modes), and anything else falls back to showing the
  raw `name`/`message` so it's at least reportable. `storageAvailable()`
  also runs a tiny probe write at Step 5 init, so a fully-blocked
  browser shows a persistent warning banner (and disables "Save current
  job") immediately — before the user loses an edit session by
  discovering it only after clicking Save.

## Security note
Saved jobs contain a person's photo and (optionally) their name. They
live in the browser's localStorage in plaintext, with no expiry — if
this were used on a shared/public machine, saved jobs would be readable
by the next person to open dev tools. Worth a "clear all jobs" control
and/or an explicit retention policy if this goes beyond prototype use.

## Status vs. original spec (see feature spec in project knowledge)
**Done:**
1. Page Setup: orientation + 9 paper size presets (2R/3R/4R/5R/6R/8R,
   A4, Letter, Legal)
2. Upload & Edit: drag-drop/file-picker upload, select/drag/resize the
   photo (Fabric.js), **Delete selected layer**, a plain brush **Eraser**
   with a visible on-canvas brush-size cursor (punches to transparent —
   not AI/content-aware, see Known simplifications), **Undo/Redo**
   (Ctrl+Z/Ctrl+Y, full-state snapshots), **Auto Enhance** (plain Canvas
   2D auto-contrast/saturation/sharpen — see the `autoEnhance.js` bullet
   above), remove background (also with a real download-percentage
   progress bar), change background (solid/custom/transparent),
   **Command Options** — a Male/Female toggle plus **Add Formal Attire**,
   which sends the photo to the user's own configured AI provider(s) to
   generate them actually wearing formal attire (see the "Real virtual
   try-on" writeup near the top and the `modelProviders.js`/
   `aiAttireAssistant.js`/`formalAttireCommand.js` bullets above — this
   replaced the old manual overlay/"Align to photo" system entirely),
   auto-fit face (one-shot heuristic), workspace zoom (Photoshop-style —
   zooms the view, not the photo)
3. Live Preview: packs every added ID size onto the sheet with
   toggleable cutting guides, its own independent zoom control, always
   live
4. Step 3 — ID Photo Sizes & Customization: standard sizes (1×1, 2×2,
   1.5×1.5, passport 35×45mm) or custom W×H, quantity, **add multiple
   different sizes to the same sheet** via "Add to sheet" (removable
   list), each packed shelf automatically centered independently (see
   the `livePreview.js` bullet above — per-shelf centering, not just
   centering the whole block; this is automatic, not a button), name tag
   (customizable text *and* color). Wired into Live Preview via
   `idsize:change`.
5. Step 4 — Print Layout, Print Preview & PDF Export: sheet margin,
   cutting-guide toggle, tight-packing toggle, watermark/proofing
   overlay, and a shared **Print Preview modal** (WYSIWYG, opened by
   either "Print" or "Export PDF") offering real browser printing
   (actual-size `@page` CSS) and PDF export (jsPDF, self-hosted, loaded
   on first use) from the same screen. Wired into Live Preview via
   `printlayout:change`.
6. Step 5 — Save Job: saves the whole job (page setup, ID size
   entries/name tag, print layout, photo edit incl. photo position+scale)
   both to a `localStorage` list AND, via a native Save
   dialog where supported (Chrome/Edge), as a real portable .json file —
   plus "Import job .json" to open one on any computer running the app.
   Each list entry re-saves in place with a confirm step ("Save"), or
   removes itself from the list ("Delete"). See Known simplifications
   for storage/browser-support caveats.
7. **Startup gate & "Create New Job"**: on load, a modal offers "New
   Job" (blank workspace) or "Open Job" (pick from the same saved-jobs
   list Step 5 uses) before any panel is usable. A "Create New Job"
   button stays in the header afterward — clicking it warns (Cancel /
   Discard / Save & New) if the workspace has unsaved changes before
   clearing back to blank.
8. **AI Providers settings panel** (header button, top-right): add/test/
   delete provider API keys (Gemini, OpenRouter, Hugging Face,
   Pollinations, Qwen, Groq, OmniRoute, or a generic Custom/OpenAI-
   compatible endpoint), live "Test" with real model discovery, key-
   format auto-detection (paste a key, the right provider preset
   auto-selects), and auto-test-on-boot for any saved provider that
   hasn't been tested yet. See `modelProviders.js`/`providerSettings.js`
   bullets above.

**Not started yet:**
- **AI Eraser** (real content-aware inpainting/object removal, as
  distinct from the plain brush Eraser that IS built) — deferred, not
  forgotten; see Known simplifications for the concrete ~225MB size
  reason.
- Keyboard shortcuts beyond Ctrl+Z/Y, alignment/snapping guides,
  flip/rotate, tooltips
- A fully-autonomous "search the web for a provider's current API docs
  and patch its request logic without human approval" system was asked
  for as an extension of Add Formal Attire's provider auto-testing —
  judged technically infeasible/unsafe for a static, no-build-step app
  (nothing here can safely rewrite and reload its own source at
  runtime) and not built; auto-detect-provider-from-key-format and
  auto-test-on-boot (both real, see above) were built as the safer,
  bounded alternative instead.

## Standalone bundle (for mobile testing)
There's a script pattern used earlier in this project to inline
`css/styles.css` and all `js/modules/*.js` + `js/app.js` into one
self-contained `index-standalone.html` (no relative paths, so it opens
correctly even via Android `content://` URIs that break relative asset
loading). If you regenerate it, keep the script concatenation order
matching the `<script src="...">` order in `index.html` — order matters
because these are plain scripts registering global `const`s, not ES
modules. Fabric.js and jsPDF now live in `vendor/` rather than a CDN —
copy that folder alongside the standalone bundle (or inline their
contents as extra `<script>` tags) so it stays offline-capable too.

## Desktop app (Electron)
Lives entirely in `desktop/` (see "Two independent copies" at the top
of this file) — all paths below are relative to `desktop/`. Wraps the
exact same `index.html`/`css/`/`js/`/`vendor/`/`assets/` (desktop's own
copy) in a native window — `electron/main.js` calls
`win.loadFile('index.html')` instead of a browser opening it.
`nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` in
the renderer — the app is plain DOM/canvas/localStorage code for
everything except Save Job's file dialog (see below), which needs
`electron/preload.js`'s narrow bridge. No menu bar
(`Menu.setApplicationMenu(null)`) since this isn't a document-editor-
style app.

**Save Job's native dialog goes through Electron's own `dialog`/`fs`
IPC, not the browser's File System Access API.** Real-world testing
found `window.showSaveFilePicker` didn't reliably show an actual Save
dialog when running under Electron's `file://` origin — clicking "Save
current job" would add the job to the in-app list (the plain
`localStorage` write, unaffected) but never prompt for a location,
which is a silent, easy-to-miss failure mode since nothing looked
broken except the missing dialog. Rather than keep chasing exactly why
that browser API behaved differently from a real Chrome tab, the fix
routes around it entirely:
- `electron/preload.js` — a `contextBridge.exposeInMainWorld('electronAPI', ...)`
  preload script exposing exactly two methods:
  `saveJobFileAs(data, suggestedName)` (opens a real Save dialog) and
  `writeJobFile(filePath, data)` (silently overwrites an already-chosen
  path — the saved-jobs list's "Save" button's re-save). Works fine
  under `sandbox: true` — that's the standard, recommended combination
  for a preload script (`contextBridge` doesn't need Node integration).
- `electron/main.js` — `ipcMain.handle('save-job-file-as', ...)` calls
  `dialog.showSaveDialog()` then `fs.writeFileSync()`;
  `ipcMain.handle('write-job-file', ...)` just does the `fs.writeFileSync()`
  part, no dialog.
- `js/modules/saveRecopy.js` (desktop copy) — `saveJobToFile()` tries
  `window.electronAPI` first (only ever present when Electron injected
  the preload script — never in a plain browser tab), then falls back
  to the browser's own File System Access API, then to a plain download
  — see the `saveRecopy.js` bullet in Architecture above for the full
  priority order (shared write-up, since mobile has an analogous
  bridge-first pattern for the same reason). A job's "linked file" is
  therefore either a `FileSystemFileHandle` (browser fallback path) or
  a plain path string (Electron path, since `dialog.showSaveDialog`
  returns a path) — `handleDisplayName()` normalizes either for display.
- Verified via `npm start`: launched the packaged app, confirmed no
  preload-load errors in the main process's own output (Electron prints
  those to the terminal if a preload script throws) and that the window
  opens with the correct title — full interactive Save-dialog click-
  through wasn't automatable in this environment (no way to drive a
  native OS Save dialog from here), so this rests on Electron's
  `dialog`/`fs` IPC being the standard, well-documented pattern it is,
  plus confirming the bridge loads without error.

- `npm install` — installs `electron`/`electron-builder` (devDependencies
  only; not part of the shipped app).
- `npm start` — runs the app in a dev window (`electron .`).
- `npm run dist` — builds the Windows installer via electron-builder →
  `dist-installer/PrintPix Rush ID Setup <version>.exe` (NSIS, ~80MB,
  bundles Chromium + Node since that's what Electron *is* — this is the
  trade-off for zero compatibility risk vs. a lighter framework like
  Tauri, which was the deliberate choice made here). Installer lets the
  user pick the install directory, creates Desktop + Start Menu
  shortcuts (`build.nsis` in `package.json`).
- `build/icon.ico` — a real **multi-resolution** ICO (16/32/48/256, all
  from the same transparent source) generated by
  `../scripts/generate-icons.ps1` — see "App icon" below for why this
  replaced an earlier single-size version and how to regenerate it.

**Known build-environment gotchas** (only matter when re-running
`npm install`/`npm run dist` on a machine that hasn't built this before):
- **Electron's own binary download is large (~113MB) and this
  environment's connection to it was unreliable** — `npm install` failed
  repeatedly with `ECONNRESET` partway through Electron's postinstall
  download, even after switching to the `npmmirror.com` mirror via
  `ELECTRON_MIRROR`. Worked around by downloading the win32-x64 zip
  directly via `Invoke-WebRequest` into `.electron-cache/` (gitignored,
  ~265MB extracted — kept around specifically so a future reinstall can
  reuse it instead of re-downloading), extracting it, then running
  `npm install` with `ELECTRON_OVERRIDE_DIST_PATH` pointed at the
  extracted folder — Electron's postinstall recognizes that env var and
  skips downloading entirely. If a fresh `npm install` ever hits the
  same `ECONNRESET` pattern again, repeat that: download the matching
  `electron-v<version>-win32-x64.zip` from
  `https://npmmirror.com/mirrors/electron/<version>/`, extract it
  anywhere, then `$env:ELECTRON_OVERRIDE_DIST_PATH = "<that path>"; npm install`.
- **`npm run dist` fails with "Cannot create symbolic link: A required
  privilege is not held by the client"` while extracting `winCodeSign`**
  — electron-builder downloads a bundle (`winCodeSign-2.6.0.7z`) that
  contains both Windows-needed tooling (`rcedit`, used to embed the
  icon/version info into the .exe) *and* unused macOS code-signing
  `.dylib` files as symlinks, all in one archive; Windows blocks
  non-elevated symlink creation by default, so 7-Zip fails extracting
  the macOS half even though the build never needed it. Setting
  `CSC_IDENTITY_AUTO_DISCOVERY=false` does NOT avoid this (still fetches
  the bundle regardless of target platform). The actual fix: enable
  **Windows Developer Mode** (Settings → Privacy & security → For
  developers), which grants `SeCreateSymbolicLinkPrivilege` to the
  current user without needing admin/elevation. This is a one-time
  machine setting, not a per-build step — no user-facing change to the
  built installer, purely a build-environment requirement.

## Mobile app (Android)
Lives entirely in `mobile/` (see "Two independent copies" at the top of
this file) — all paths below are relative to `mobile/`, e.g.
`js/modules/canvasEditor.js` means `mobile/js/modules/canvasEditor.js`,
not any shared root. Two build paths exist, producing a signed,
installable `.apk` — same "no code changes to the web app" philosophy
as the Electron desktop build. Both load `mobile/index.html`/`css/`/
`js/`/`vendor/`/`assets/` (via `scripts/sync-www.js` → `www/`,
gitignored, `mobile/`'s own files stay the source of truth for the
mobile build specifically — see the top-of-file note on why this is no
longer shared with `desktop/`).

### Path A — Capacitor + Gradle (the normal way; use this on a machine
### without this project's specific build-environment bug, see below)
`@capacitor/core`/`@capacitor/cli`/`@capacitor/android` wrap the web app
in a real native Android project under `android/` (generated via
`npx cap add android`, not hand-edited except `app/build.gradle`'s
`signingConfigs` block and `gradle.properties`). Icons/splash screens
were generated from `resources/icon.png` (a 1024×1024 copy of the
original logo upload) via `npx capacitor-assets generate --android`.
- `npm run sync:mobile` — copies root files into `www/`, runs
  `cap sync android`.
- `npm run build:apk` — syncs, then `gradlew.bat assembleRelease` →
  `android/app/build/outputs/apk/release/app-release.apk`.
- Signing: `android/keystore/printpix-release.keystore` (self-signed,
  generated via `keytool`, gitignored — never commit a real signing
  key), referenced from `app/build.gradle`'s `signingConfigs.release`.
  Fine for direct/USB distribution; would need a *different* keystore
  (kept secret, backed up) if this ever goes on the Play Store, since
  losing that key means losing the ability to publish updates to the
  same app listing.
- Chromium version bundled with modern Android WebView (which Capacitor
  apps run on) does **not** support the File System Access API — Save
  Job's native picker (see Save Job's Electron section above) silently
  isn't available on Android; `saveRecopy.js`'s `supportsFileSystemAccess()`
  check already handles this by falling back to a plain download, same
  as it does in Firefox/Safari on desktop. No mobile-specific code
  needed for this.

**This project's dev machine hit a real, unresolved build-environment
bug on Path A** — worth understanding even if you're not hitting it
yourself, since the symptoms are confusing: `gradlew.bat` (any command,
`assembleDebug`/`assembleRelease`, `--no-daemon` or not) fails
immediately with `java.io.IOException: Unable to establish loopback
connection`. `--stacktrace` traces it to
`sun.nio.ch.WEPollSelectorProvider`/`WEPollSelectorImpl` (a Windows
NIO `Selector` implementation, newer than the classic
`WindowsSelectorProvider`, that uses a Unix-domain-socket pair
internally for its self-pipe wakeup mechanism) failing at
`UnixDomainSockets.connect0` with `SocketException: Invalid argument:
connect` — i.e., this specific Windows environment's AF_UNIX socket
support is broken/unavailable, and Gradle's daemon-connector
architecture requires a working `Selector` for its own IPC on *every*
invocation, daemon or not (`--no-daemon` still forks and connects to a
"single-use daemon"). **Confirmed NOT JDK-version-specific** — identical
failure on both Temurin 17.0.20 and Temurin 21.0.12. No JVM system
property (`-Djava.nio.channels.spi.SelectorProvider=...`, tried both as
`JAVA_OPTS`/`GRADLE_OPTS` env vars and via `org.gradle.jvmargs` in
`gradle.properties`) fixed it — there may not be a valid fallback
`SelectorProvider` class left in modern JDKs to select. If this recurs
on a future machine: try a real (non-virtualized/sandboxed) Windows
install, WSL2, or building via CI (GitHub Actions' runners don't have
this restriction) before spending more time on JVM flags.

### Path B — hand-built, no Gradle (the fallback actually used to
### produce the shipped APK, since Path A is blocked in this environment)
`scripts/build-apk-manual.ps1` drives the Android SDK's own standalone
command-line tools directly, replicating just enough of what Gradle/AGP
would do:
1. `javac` compiles `manual-apk/src/.../MainActivity.java` against
   `platforms/android-34/android.jar`.
2. `d8` converts **every** compiled `.class` file (not just the named
   `MainActivity.class`) to `classes.dex` — see "A real device crash,
   root-caused" below for why this matters.
3. `aapt2 compile` + `aapt2 link` compile `manual-apk/res/` (the launcher
   icons at every density, plus `values/styles.xml`) and
   `AndroidManifest.xml` into a base (assets-less) APK.
4. `classes.dex` **and** `manual-apk/assets/` are added via the JDK's
   own `jar` tool, NOT `aapt2 link -A` — `aapt2 -A` was tried first and
   silently produced zip entries with **backslash** path separators for
   nested asset subdirectories on Windows (e.g. a literal
   `assets/www\css\styles.css` entry, not `assets/www/css/styles.css`
   nested paths) — caught by inspecting `zipalign`'s verification
   output, not by an error (aapt2 didn't complain). Android's asset
   manager needs real forward-slash nesting to resolve
   `file:///android_asset/www/index.html`; the backslash version would
   have looked fine in a file listing but resolved to nothing at
   runtime — a silent, easy-to-miss failure if not checked. `jar`
   normalizes to forward slashes correctly regardless of host OS.
5. `zipalign` (4-byte alignment) → `apksigner sign` with the same
   release keystore as Path A.
- `manual-apk/src/.../MainActivity.java` — a single `Activity` hosting
  a plain `android.webkit.WebView` pointed at
  `file:///android_asset/www/index.html`, with JS + DOM storage
  (localStorage) enabled. **No Capacitor, no AndroidX at all** — this
  app calls zero native APIs (same reasoning as the File System Access
  gap above: it's plain DOM/canvas/localStorage code), so a bare
  `WebView` shell is functionally equivalent to what Capacitor's own
  generated shell provides *for this app specifically*. This would NOT
  hold if a native plugin (camera, filesystem, share sheet, etc.) is
  ever added — that would require going back to Path A (or hand-rolling
  the specific plugin's native code, which defeats the point of using
  Capacitor at all).
  - **`onShowFileChooser` must be implemented explicitly** — a bare
    `new WebChromeClient()` (what shipped in the very first APK) does
    NOT support `<input type="file">` at all; clicking upload/browse
    silently does nothing, no error, no fallback. Found via real-device
    testing (the emulator wasn't set up yet at that point). Fixed by
    overriding `onShowFileChooser` to launch `params.createIntent()` via
    `startActivityForResult`, and `onActivityResult` to feed the picked
    `Uri`(s) back to the `ValueCallback`. This is the standard,
    well-documented pattern for file inputs in a raw `WebView` — Chrome
    Custom Tabs / Capacitor's own generated shell handle this
    automatically, which is why it wasn't needed for the file:// browser
    or Electron builds.
- Rebuild with `npm run build:apk:manual` after any app change →
  `manual-apk/build/PrintPixRushID-signed.apk`. **Set
  `$env:PRINTPIX_KEYSTORE_PASSWORD` first** — the keystore password used
  to be hardcoded in this script and `android/app/build.gradle`; it was
  removed when the repo went public (the keystore file itself is
  gitignored). The old password still exists in git history; that's low
  risk while the keystore stays private, and rotating the key would stop
  already-installed APKs from updating, so it was left as is. SDK/JDK
  paths can be overridden with `PRINTPIX_ANDROID_SDK` / `PRINTPIX_JDK17`
  (deliberately not `ANDROID_SDK_ROOT`, which is often set system-wide to
  something else).
- `minSdkVersion 22` (Android 5.1+, broad compatibility) /
  `targetSdkVersion 34`, matching Path A's `variables.gradle` defaults.

### A real device crash, root-caused (not a theme/orientation issue)
A real-device test after the `onShowFileChooser` fix above reported the
app opening and immediately closing every time. `adb logcat` showed the
actual cause: `NoClassDefFoundError: Failed resolution of:
Lcom/printpixrushid/app/MainActivity$1;` thrown mid-`onCreate()`. Root
cause: `javac` emits a **separate `.class` file per anonymous inner
class** — the `new WebChromeClient() {...}` added for the file-chooser
fix compiles to `MainActivity$1.class`, distinct from
`MainActivity.class`. The build script's dexing step was still passing
`d8` only the one hardcoded `MainActivity.class` path; `d8` didn't
complain about the missing sibling class, so the build "succeeded" and
shipped an APK that crashed the instant Android tried to instantiate
that anonymous class. Fixed by dexing every `.class` file under
`build\classes\...` (`Get-ChildItem *.class`, see the numbered list
above) instead of one hardcoded name.

**My first hypothesis was wrong** — before finding the real cause via
logcat, an Android-8-era "only fullscreen opaque activities can request
orientation" theme issue was suspected and a defensive `AppTheme` style
(`manual-apk/res/values/styles.xml`) was added. That style is harmless
and stayed in (explicit theme beats relying on a WebView default), but
it was **not** what fixed the crash — the dexing fix was. Recorded here
so this isn't mistaken for the real root cause later. Verified fixed via
a real emulator run: clean `adb logcat` (no `FATAL EXCEPTION`), stable
PID, and a real screenshot of the app rendering.

### Three more real-device bugs traced to bare-WebView gaps (round 3)
A later real-device test reported three more failures, all specific to
`mobile/`: "Remove background" failing outright, and both "Download PDF"
and the Print Preview modal's "Print" button doing nothing. All three
trace back to facilities a real browser has that a plain
`android.webkit.WebView` doesn't, fixed in `MainActivity.java`:

1. **"Remove background" (and custom-attire cutout) failing** — the
   page is loaded from `file:///android_asset/www/index.html`, and
   `WebSettings.setAllowUniversalAccessFromFileURLs`/
   `setAllowFileAccessFromFileURLs` **default to `false`** for apps
   targeting API 16+. That blocks every `fetch()`/dynamic `import()`
   from a `file://` page to any `https://` origin outright, before CORS
   even enters into it — so `bgRemoval.js`'s
   `import('https://esm.run/@imgly/background-removal')` and the
   model's own asset fetches never had a chance to succeed. Fixed by
   setting both to `true`. **Confirmed fixed on-device**: a temporary
   self-test snippet (added to `index.html`, run once, then removed —
   see below) ran `fetch('https://esm.run/@imgly/background-removal')`
   directly and reported `status: 200 ok=true` on the emulator, vs.
   failing outright before this fix.
2. **"Download PDF" / Save Job's file-download fallback doing nothing**
   — both go through an `<a download>` click on a `blob:` URL, which
   depends on the WebView having a `DownloadListener` registered; this
   app's `MainActivity` never set one, and there is no default handler,
   so the click was a silent no-op (no error, no dialog, nothing).
3. **The Print Preview modal's "Print" button doing nothing** —
   `window.print()` is simply not implemented by
   `android.webkit.WebView` at all; there's no flag to enable it and no
   fallback when it's missing, unlike a real browser.

(2) and (3) don't have a browser-API substitute — a bare WebView has no
system download/print facility to fall back to — so both needed real
native code, added as a small JS-to-Java bridge:
- **`window.AndroidBridge`**, injected via
  `webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge")`,
  with three `@JavascriptInterface` methods (originally two — see the
  round 3.1 correction just below the Verification paragraph for why
  `saveFile` became `saveFileAs` + `writeToUri`):
  - `saveFileAs(requestId, base64Data, filename, mimeType)` — opens
    Android's Storage Access Framework `ACTION_CREATE_DOCUMENT` picker
    (the real system "Save as" dialog: any folder, any storage
    provider) and, once the user actually picks a location, writes the
    bytes there. Needs no storage permission on any supported API level
    — this replaced an earlier `MediaStore`/legacy-`File` implementation
    that needed `WRITE_EXTERNAL_STORAGE` on API 23-28 and, worse, never
    showed the user a choice at all. Fire-and-forget from JS (`void`
    return) since showing a picker is inherently asynchronous — see
    `writeToUri` below for how the result gets back to JS.
  - `writeToUri(requestId, uriString, base64Data)` — silently overwrites
    a `content://` Uri returned by an earlier `saveFileAs`, no picker
    shown — the mobile equivalent of Electron's `write-job-file` IPC
    handler or the browser's `FileSystemFileHandle.createWritable()`,
    used by the saved-jobs list's "Save" button to re-save in place.
    `onActivityResult` also calls
    `getContentResolver().takePersistableUriPermission(...)` right after
    the picker returns, so this keeps working across the rest of the
    app's process lifetime, not just the one activity instance.
  - Both post their result back to JS via
    `webView.evaluateJavascript("window.__androidSaveFileCallback(id, result)", null)`
    on the UI thread, matched to the original call through `requestId`
    — `org.json.JSONObject.quote()` handles safe JS-string escaping for
    the two arguments. `result` is `"ok:<uriString>"`, `"cancelled"` (the
    picker was dismissed without choosing a location), or
    `"error:<message>"`.
  - `printImage(base64Png, widthIn, heightIn)` — decodes the PNG,
    renders it as the one page of a `PrintedPdfDocument` sized to the
    requested physical dimensions (`PrintAttributes.MediaSize` in mils,
    `NO_MARGINS`), and hands it to `PrintManager.print()`. Runs on
    `runOnUiThread` (PrintManager needs it) via a plain anonymous
    `Runnable`, **not a lambda** — javac fails to compile lambda syntax
    with `cannot find symbol ... LambdaMetafactory.metafactory` when
    `-bootclasspath` is `android.jar` (a stub jar with no real
    `LambdaMetafactory` for javac to resolve the `invokedynamic` call
    site against); every other callback in this file already used plain
    anonymous classes for the same underlying reason, this one just
    hadn't been tried with a lambda before. Real printers/print services
    may not honor an arbitrary custom media size — same caveat as the
    browser `@page` CSS path, just via Android's print framework;
    "Save as PDF" (built into Android, always available) is guaranteed
    to respect it.
  - `callProvider(requestId, method, url, headersJson, body)` — added
    for the AI Formal-Attire Assistant (see `modelProviders.js` above).
    Same "browser fetch() is subject to CORS/WebView restrictions, a
    native HTTP client isn't" reasoning as `printImage`/`saveFileAs`,
    just for outbound AI-provider API calls instead. Makes the real
    request via `java.net.HttpURLConnection` on its **own background
    `Thread`** (not the WebView JS-bridge thread `addJavascriptInterface`
    methods normally run on, and never the UI thread) since a generation
    request can take several seconds — blocking either of those would
    freeze the page or the app. Posts the result back via
    `webView.evaluateJavascript("window.__androidProviderCallback(id,
    ok, status, body)")` on the UI thread, matched to the original call
    through `requestId` — mirrors `saveFileAs`/`writeToUri`'s
    request/callback pattern exactly. A response whose `Content-Type`
    starts with `image/` is base64-encoded before being sent back (some
    providers return raw image bytes instead of JSON); everything else
    is passed through as plain text — same convention as Electron's own
    `ai-provider-call` IPC handler, so `modelProviders.js`'s
    `callHttp()` handles either bridge's result identically.
    **Known gap, not yet hit in practice**: `AndroidManifest.xml` sets
    `android:usesCleartextTraffic="false"`, which blocks plain
    (non-TLS) `http://` requests app-wide — a provider configured with
    a plain-HTTP Base URL (e.g. a self-hosted OmniRoute instance) would
    fail here even though the same request works fine through Electron.
    Every provider preset actually shipped/tested (Gemini, OpenRouter,
    Hugging Face, Pollinations) uses `https://`, so this hasn't been a
    real problem yet; would need a network security config exception
    (or asking the user to use an `https://` tunnel to their local
    server) if a plain-HTTP custom provider is ever needed on mobile.
- `js/modules/printExport.js` and `js/modules/saveRecopy.js` (mobile
  copies only) each have a small `hasAndroidBridge()`/local
  `blobToBase64()` helper and check `window.AndroidBridge` before their
  existing browser-API/download paths — see the `saveRecopy.js` bullet
  in Architecture above for the full priority order. Desktop's copies
  of these files have no knowledge of `AndroidBridge` at all — it's
  simply never present there. Since `saveFileAs`/`writeToUri` are
  fire-and-forget on the Java side, both files also share one
  `saveViaAndroidBridge()`/`writeViaAndroidBridge()` pattern: a shared
  `window.__androidSaveCallbacks` map and `window.__androidSaveRequestSeq`
  counter (idempotently registered — `x = x || ...` — so whichever of
  the two script tags runs first "wins" harmlessly) resolve a Promise
  once `window.__androidSaveFileCallback(requestId, result)` fires.
  These live on `window`, not either module's own closure, specifically
  because *both* files use this same bridge (PDF export and Save Job)
  — a per-module closure would let whichever script tag loads last
  silently clobber the other's pending-callback registry.

**Verification**: rebuilding after adding `AndroidBridge` first failed
with the `LambdaMetafactory` error above (a real compile bug, not a
runtime one — caught immediately by the build script's `Invoke-Checked`
exit-code check, not shipped). After fixing it, a temporary self-test
snippet was added to the very end of `index.html`'s `<body>` (removed
before the final rebuild — search git history / this section if it
needs recreating): on load, it checked `window.AndroidBridge` presence,
called `saveFile()` with a small text payload, called `printImage()`
with a 1×1 test PNG, and did the CDN `fetch()` above, writing every
result as visible on-screen text (chosen over `console.log`, since
WebView JS console output doesn't reach `adb logcat` without an
`onConsoleMessage` override — see the emulator section below). This was
necessary because the WebView's page content isn't exposed to
`uiautomator`'s accessibility tree (no accessibility service was
enabled), so screenshot-based coordinate tapping couldn't reliably
drive the real UI through 5 steps to reach each feature. Results on a
real emulator run (`PrintPixLean`, Android 8.1/API 27):
`AndroidBridge present: true`; `printImage` genuinely opened Android's
real system Print dialog (visually confirmed via screenshot, twice —
once on first launch, once again after a relaunch re-ran the self-test);
`CDN fetch status: 200 ok=true` (the CORS/file-access fix, confirmed
working end-to-end); `saveFile` returned an `"error:...Permission
denied"` string — expected on this specific API 27 test image per the
`WRITE_EXTERNAL_STORAGE` limitation described above (this emulator
predates the modern `MediaStore` path entirely), not evidence the
modern-Android code path is broken, just not directly exercised by this
particular AVD. No `FATAL EXCEPTION` at any point across this session.

**Round 3.1 correction — the fix above still wasn't what was actually
asked for.** The `saveFile()` design above wrote silently to the
Downloads folder with no user interaction at all — it fixed "nothing
happens when I tap Save", but real-device follow-up feedback pointed
out it never satisfied the *original* ask: a real dialog letting the
user pick *where* to save, the same as desktop's Save-As dialog. There
was no bug to find here — the code did exactly what it was written to
do — the fix targeted the wrong requirement. Replaced with the SAF-based
`saveFileAs`/`writeToUri` pair described above, which opens Android's
real system "Save as" picker instead. Worth remembering: "no error,
file appears to save somewhere" and "did what the user actually asked
for" are different bars, and confirming only the former isn't enough
when the request was specifically about a visible choice, not just a
successful write.

### Mobile-only differences from `desktop/`'s copy
Found via testing on a real device — these are deliberately NOT ported
to `desktop/`, since they'd be wrong there (see "Two independent
copies" at the top of this file):
- **Locked to landscape** — `AndroidManifest.xml`'s `<activity>` has
  `android:screenOrientation="landscape"` plus a broad
  `android:configChanges` list (orientation/screenSize/keyboardHidden/
  etc.) so Android never destroys-and-recreates the Activity on a
  rotation or keyboard show/hide. This app's layout (step rail + canvas
  + inspector panel, side by side) is desktop-shaped and doesn't have a
  portrait-friendly redesign; rather than build one, the app just always
  renders in its landscape-shaped layout regardless of how the phone is
  physically held — no "please rotate your phone" prompt needed, and no
  UI ever gets cut off in portrait since portrait rendering never
  happens. If a real responsive portrait layout is ever built, this
  should be revisited (removing the lock would let the CSS's own media
  queries take over).
- **Zoom starts more zoomed out** — `canvasEditor.js`'s `MIN_ZOOM`
  lowered from desktop's `0.25` to `0.10`, with a new `INITIAL_ZOOM =
  0.10` applied at `init()` (was `applyZoom(1)`, i.e. 100%, on desktop).
  `livePreview.js`'s `init()` similarly calls `applyPreviewZoom(0.25)`
  instead of defaulting to 100%. A phone screen is too small to make
  sense of either pane at desktop's 100% starting zoom; both still zoom
  freely up to their normal max afterward. `index.html`'s static
  `zoomLabelText`/`previewZoomLabel` default text and the workspace
  zoom slider's `min`/`value` attributes were updated to match, so
  there's no flash-of-wrong-number before JS runs.

## Autosave / crash-recovery (shared — both `desktop/` and `mobile/`)
`jobLifecycle.js` also debounce-writes a full job snapshot to
`localStorage['printpixRushId.autosave']` on every dirty-tracking event
(the same ones behind the "unsaved changes" flag), separate from the
named Save Job list. On boot, if that draft has an actual photo in it,
the startup gate offers a third option, **"Continue where you left
off"** (styled as the primary action when shown, demoting "New Job" to
outline), which re-applies it via the same `SaveRecopy.applyJob()` path
as Open Job.

Added specifically because testing found work was lost on an ordinary
page refresh (no autosave existed at all before this — there was
nothing accidentally broken, the feature just didn't exist yet), and
because Android can recreate/destroy the WebView's host Activity under
memory pressure independent of any configChanges declaration. The
`android:configChanges` list above should mean the Activity is never
destroyed for a rotation specifically anymore, but autosave remains
useful defense-in-depth for that scenario, and is the actual fix for
the browser/desktop refresh case (which configChanges can't touch at
all — that's a distinct root cause with no manifest-level fix).

## App icon (shared — both `desktop/` and `mobile/`)
The original logo upload had an opaque background (light-gray outer
page + a white rounded-square tile + a navy border ring + a small
sparkle decoration) behind the actual pictogram (lightning bolt/camera-
aperture/ID-badge). Two real problems needed fixing, found via user
feedback on real devices — "blurred" icon and a visible white
background where the user wanted "pure logo lang":

1. **Blurred mobile icon**: the manual APK build (Path B) only ever
   shipped a single `mipmap-mdpi` (48×48) launcher icon — Android
   upscales that on any higher-density real screen (most phones are
   `xhdpi`/`xxhdpi` or denser), which reads as blur. Not a rendering bug,
   just a missing-asset gap.
2. **Visible white/gray background**: the source logo's background was
   never actually removed — earlier icon generation just downscaled the
   full opaque square.

Fixed with two one-time scripts in `scripts/` (repo root, shared by both
platforms since the source logo is shared):
- **`remove-logo-bg.ps1`** — a difference-matte background removal
  against the three known background reference colors (outer gray,
  white tile, navy border ring), each pixel matched to whichever
  reference is closest, mapped to alpha via a low/high distance ramp,
  with edge-pixel "unmixing" (stripping the background's own color
  contribution proportional to remaining alpha) to avoid a pale halo at
  the old tile border. Produces `logo-transparent-1024.png` at the repo
  root — the single verified-clean source everything else derives from.
  Verified via direct `Bitmap.GetPixel()` sampling (A=0 at background
  sample points, A=255 with correct pictogram RGB at content sample
  points) — **the `Read` tool's own image preview does NOT reliably
  render PNG alpha transparency** (composites onto some opaque
  fallback), so trust pixel sampling or a checkerboard-composited
  preview over eyeballing a `Read` preview when verifying transparency.
- **`generate-icons.ps1`** — resizes that transparent source (high-
  quality bicubic, `Format32bppArgb` throughout so alpha survives every
  resize) to every size both platforms actually need in one pass:
  the 128×128 in-app header brand-mark (`assets/logo.png`, both
  platforms), a real multi-resolution `desktop/build/icon.ico`
  (16/32/48/256 — see "Desktop app (Electron)" above for why a single
  size wasn't enough there either — Windows picks whichever embedded
  size fits the context: taskbar, title bar, Explorer views, Start
  Menu), every Android launcher density in
  `mobile/manual-apk/res/mipmap-*/ic_launcher*.png` (mdpi 48 / hdpi 72 /
  xhdpi 96 / xxhdpi 144 / xxxhdpi 192, both the square and `_round`
  variant — same square source for both, letting the OS apply its own
  round mask), and `mobile/resources/icon.png` (Path A's Capacitor
  source, kept in sync for consistency even though Path B is what
  actually ships).
- Both scripts are one-time asset-prep, not part of any regular build —
  re-run them by hand only if the source logo changes, then rebuild the
  desktop installer / mobile APK to pick up the new files (icons aren't
  regenerated automatically by `npm run dist` or
  `build-apk-manual.ps1`).

## Self-testing the Android build (emulator)
An AVD now exists on this dev machine for exactly this — don't ship a
mobile change without running it here first if a real device isn't
handy:
- SDK packages installed: `system-images;android-34;google_apis;x86_64`
  + `emulator` (via `sdkmanager`, alongside the platform-tools/build-
  tools/platform already needed for Path B above).
- AVD created: `avdmanager create avd -n PrintPixTest -k
  "system-images;android-34;google_apis;x86_64"` (the interactive
  "create a custom hardware profile? [no]" prompt needs stdin
  redirected from a file — `echo no | avdmanager ...` piped through
  PowerShell did NOT reach the underlying java process; redirecting
  from an actual file, `avdmanager ... < answer.txt`, did).
- Launch headless (no visible window needed, just `adb`):
  `emulator -avd PrintPixTest -no-window -no-audio -gpu
  swiftshader_indirect`. Wait for boot via
  `adb shell getprop sys.boot_completed` (poll until it prints `1`,
  typically ~30-90s cold boot).
- Install + launch the built APK:
  `adb install -r manual-apk\build\PrintPixRushID-signed.apk` then
  `adb shell am start -n com.printpixrushid.app/.MainActivity`.
- `adb logcat` (optionally piped through `findstr`/`grep` for
  `chromium`) is the way to see what's actually happening on-device
  instead of guessing from build success alone. **Correction to an
  earlier note in this file**: JS console output (`console.log`/error/
  warn, and uncaught JS exceptions) DOES reach `adb logcat` by default,
  even without overriding `WebChromeClient.onConsoleMessage` — it shows
  up as `chromium: [INFO:CONSOLE(...)]` entries. Confirmed via real
  self-test output during a later testing pass (this file previously,
  incorrectly, said the opposite — don't trust that old claim if you
  see it repeated elsewhere in old notes/commit messages).

**This emulator is unreliable in this dev environment** — worth knowing
before trusting a "works on the emulator" result, or spending time
chasing what looks like an app bug there. Observed repeated "System UI
isn't responding" ANRs at the plain Android home screen, before our app
was even involved, and later an actual ANR for
`com.printpixrushid.app` itself (`Input dispatching timed out ...
Waited 5001ms`) — but system-wide ANRs happening independent of our app
strongly suggest general emulator/host performance overload (nested
virtualization + software `-gpu off`/`swiftshader_indirect` rendering
under this sandbox's resource limits), not a real app-level hang. Two
things WERE confirmed genuinely working via emulator screenshots before
it degraded: the app **does** launch and render in landscape (orientation
lock confirmed working), and the launcher icon installs correctly. Real
device testing (already proven reliable earlier in this project) remains
the trustworthy signal for anything beyond "does it build and launch" —
don't treat an emulator ANR/crash as proof of an app bug without also
reproducing it on a real device or in `adb logcat` output that actually
names the app's own code, not just generic system input-dispatch timeouts.

## Testing approach used so far
No test framework is set up. Verification during development was done
manually via the Browser pane, driving real UI interactions (file
uploads via `DataTransfer`, real clicks/inputs, not just direct JS state
injection) against a local PHP dev server (`.claude/launch.json` →
`printpix-rush-id`, since this machine has no other server runtime), and
sampling canvas pixels with `ctx.getImageData()` to confirm rendered
colors/positions match expectations. Worth formalizing into an actual
test file if this project keeps growing.
