# PROGRESS.md — Attire Auto-Fit & Auto-Enhance

Tracking doc for an in-progress feature build. **Read this file first** if
you're picking this up in a new session/agent — it has the full context,
decisions already made (and why), exact files to touch, and what's done
vs. not. Update the checklist and the "Session log" at the bottom after
every meaningful edit — don't let this drift out of sync with reality.

Root project doc is `CLAUDE.md` (architecture, both platforms, known
simplifications) — read that too if unfamiliar with the app. This file
is scoped to just this one feature effort.

## The ask

User reported "Align to Photo" (attire positioning) and attire image
quality aren't good enough. Wants:
1. **Auto-fit** — attire should snap to the person's *actual* detected
   body position, not the current fixed heuristic.
2. **Auto-enhance (attire)** — a way to sharpen/upscale a low-res
   uploaded attire PNG so it doesn't look blurry when scaled up on the
   canvas. **Scoped to the attire image specifically** — not the
   existing photo-level "Auto Enhance" button, which stays as-is.

## Hard constraints (confirmed with user before any design work)

- **No local GPU.** Ruled out every GPU-dependent option (ComfyUI/SD
  WebUI virtual try-on, Qwen-Image-Edit, ICEdit, Step1X-Edit — all
  diffusion-based, all need a GPU backend).
- **Must work on both `desktop/` and `mobile/`.** Ruled out anything
  that only makes sense as a desktop-only local tool.
- **Must be genuinely free** — no cloud API costs, no paid hosting.
  Ruled out Replicate/hosted-API approach and rented-GPU-cloud approach
  for the same reason (both cost real, ongoing money).
- **Also researched and ruled out** (user asked specifically):
  - **HivisionIDPhotos** — its "intelligent formal wear replacement"
    feature is listed in the repo as "waiting" — not built yet.
  - **IOPaint** — repo is archived (Aug 2025, read-only), and it solves
    inpainting (remove/fill regions), not garment-fitting anyway.
- Given all of the above, landed on: **100% client-side, browser/WebView-
  native tech, no backend at all** — consistent with this app's existing
  architecture (see CLAUDE.md's "Client-side only" framing, and the
  precedent of `@imgly/background-removal` for Remove Background: a
  model downloaded from a CDN on first use, cached after that, zero
  server involved).

## Chosen approach

### Auto-fit → MediaPipe Pose Landmarker
`@mediapipe/tasks-vision` — Google-maintained, actively developed,
Apache-2.0, runs via WASM directly in a browser/WebView. Detects body
keypoints (we need `left_shoulder`/`right_shoulder`, indices 11/12 in
MediaPipe's 33-point pose model) from the uploaded photo. Model file:
`pose_landmarker_lite.task` (~5-9MB) — "lite" variant chosen deliberately
for size/speed over the "full"/"heavy" variants, since we only need
shoulder position, not fine-grained pose.

**This does NOT generate/redraw clothing.** It only tells us *where the
shoulders are* so we can position/scale the existing attire graphic
(vector illustration or uploaded PNG) more accurately than the current
fixed "centered + 60%-down" heuristic. Framed honestly to the user as
"smarter positioning," not "AI-drawn clothing" — matches how
"Auto-Fit Face" and the old "Align to Photo" are already documented as
heuristics in CLAUDE.md's Known Simplifications.

Loading strategy: **CDN-lazy-loaded on first use** (same pattern as
`bgRemoval.js`'s `@imgly/background-removal`), NOT self-hosted in
`vendor/`. Reasoning: the mobile APK is currently ~550KB total —
self-hosting a 5-9MB model would balloon it 10-16x for a feature not
every user will click. CDN URL per MediaPipe's own docs:
`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm` (WASM
runtime) + a `.task` model file also served from a Google-hosted CDN
(exact URL to confirm during implementation — see MediaPipe's Pose
Landmarker web guide).

**Fallback behavior is mandatory, not optional**: if pose detection
fails for any reason (no internet on first use, model load error, no
person detected with sufficient confidence, mobile WebView CORS/fetch
issue), `alignAttireToPhoto()` must fall back to the *existing* heuristic
(centered + 60%-down) silently-but-honestly (hint text says which one
ran) — the button must never become non-functional. This mirrors the
existing fallback pattern in `attireControls.js`'s
`handleUploadFile()` (bg-removal failure → use upload as-is).

### Auto-enhance (attire) → ONNX super-resolution model via transformers.js
**Revised during research** (the originally-planned XLSR model at
`aplux/XLSR` on Hugging Face turned out to be a **gated/private repo** —
returns 401 Unauthorized, confirmed via direct `curl`, not usable
without an account/API key). Replaced with a verified-public alternative:
**`Xenova/swin2SR-classical-sr-x2-64`** (2x super-resolution, Swin2SR
architecture) via the **`@huggingface/transformers`** library (the
actively-maintained successor to transformers.js — wraps
onnxruntime-web internally with a clean `pipeline()` API, handles model
download/caching and tensor pre/post-processing, so there's much less
custom low-level ONNX code to get wrong). Confirmed public (`gated:
false` via the HF API) and confirmed real file sizes via direct `curl`
of the redirect target: `model_uint8.onnx` ≈ **19MB**, `model_quantized.onnx`
≈ 21.5MB — using the `uint8` dtype variant (smallest).

New action: an **"Enhance attire"** button (near "Align to photo" in the
Formal Attire panel), operates on whatever the current attire image is
(default illustration *or* uploaded custom PNG — same uniform "just an
image source" treatment CanvasEditor already gives both), replaces it
via the existing `CanvasEditor.setAttireCustomImage()` call.

Usage pattern (verified via HF docs + search, will confirm exact API
surface via real browser testing before shipping):
```js
const { pipeline, RawImage } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers');
const upscaler = await pipeline('image-to-image', 'Xenova/swin2SR-classical-sr-x2-64', { dtype: 'uint8' });
const input = RawImage.fromCanvas(canvasWithAttireDrawnOnIt);
const output = await upscaler(input); // returns a RawImage
const resultCanvas = output.toCanvas(); // browser-usable canvas
```

Loading strategy: **CDN-lazy-loaded on first use**, same as Auto-fit
above. Total first-use download (model + the onnxruntime-web WASM
runtime bundled inside `@huggingface/transformers`, roughly the same
~27MB order of magnitude CLAUDE.md's Known Simplifications already
cites for why "AI Eraser" was deferred) lands somewhere around 30-50MB
— a real but *optional, one-time* cost, matching the precedent already
set by `bgRemoval.js` ("needs internet once"). Self-hosting this in
`vendor/` was ruled out for the same reason bg-removal isn't self-hosted
either: this app's install size would balloon for a feature not every
user clicks.

## Files to touch (both `desktop/js/modules/` and `mobile/js/modules/`
## — remember these are two independent copies, port every change to
## both, see CLAUDE.md's "Two independent copies" section)

- **New**: `poseDetection.js` — lazy-loads MediaPipe, runs detection on
  a given image element, returns shoulder keypoints or `null`. Small,
  focused module — mirrors `bgRemoval.js`'s `loadModel()` pattern.
- **New**: `attireEnhance.js` — lazy-loads onnxruntime-web + XLSR,
  upscales/sharpens a given image element, returns a new image. Mirrors
  the same lazy-load pattern.
- **Edit**: `canvasEditor.js` — `alignAttireToPhoto()` becomes `async`;
  calls `PoseDetection`, uses shoulder keypoints if available, falls
  back to the existing math otherwise. Needs a loading-state signal back
  to `attireControls.js` (the button/hint text lives there).
- **Edit**: `attireControls.js` — wire the "Align to photo" button's
  click handler to handle the new async flow + loading/progress UI
  (mirror `handleUploadFile()`'s progress-bar pattern already in this
  file); add the new "Enhance attire" button, its progress UI, and its
  click handler calling `AttireEnhance` then
  `CanvasEditor.setAttireCustomImage()`.
- **Edit**: `index.html` (both copies) — new "Enhance attire" button
  markup near the existing "Align to photo" button; new `<script>` tags
  for the two new modules (order matters — see `js/app.js`'s init-order
  comment).
- **Edit**: `CLAUDE.md` — document both features once built (new
  bullets under Architecture + Known Simplifications, matching the
  existing writing style/honesty level throughout that file).

## Non-goals (explicitly out of scope for this pass)

- Real photorealistic virtual try-on (fabric folds, shadows, actual
  worn-clothing rendering) — confirmed with user this stays out of
  scope given the no-GPU/free constraint. Only positioning + image
  quality are being improved, not generated content.
- Any change to "Auto Enhance" (the existing photo-level button) or
  "Auto-Fit Face" (the existing photo-crop heuristic) — different
  features, not touched by this work.

## Checklist

- [x] Requirements clarified with user (GPU/mobile/free constraints,
      HivisionIDPhotos + IOPaint researched and ruled out, auto-enhance
      scope confirmed as attire-specific)
- [x] Approach approved by user (MediaPipe Pose + XLSR/onnxruntime-web,
      both CDN-lazy-loaded, both platforms)
- [x] `poseDetection.js` written (desktop)
- [ ] `poseDetection.js` ported to mobile
- [x] `attireEnhance.js` written (desktop)
- [ ] `attireEnhance.js` ported to mobile
- [x] `canvasEditor.js` `alignAttireToPhoto()` updated (desktop) — also
      added `getAttireElement()` (didn't exist before, needed for
      AttireEnhance)
- [ ] `canvasEditor.js` `alignAttireToPhoto()` ported to mobile
- [x] `attireControls.js` UI wiring — align button loading state (desktop)
- [ ] `attireControls.js` UI wiring — align button loading state (mobile)
- [x] `attireControls.js` UI wiring — new Enhance attire button (desktop)
- [ ] `attireControls.js` UI wiring — new Enhance attire button (mobile)
- [x] `index.html` markup + script tags (desktop)
- [ ] `index.html` markup + script tags (mobile)
- [x] Desktop: tested in Browser pane. Auto-fit: confirmed via real
      MediaPipe engine logs (TFLite XNNPACK delegate, graph running,
      landmark_projection_calculator) + hint text correctly reporting
      "Positioned using the photo's detected shoulders" + CanvasEditor's
      own getSaveState() showing a plausible computed (non-default)
      attire transform. Enhance: found and fixed two real bugs during
      testing (see below), then confirmed via isolated pipeline test
      (bypassing the slow one-time setup by reusing an already-loaded
      pipeline) — correct 2x upscale (64x64 -> 128x128), valid PNG
      output. NOT re-tested end-to-end through the real UI after the
      hint-text-only follow-up edit — low risk, no logic changed.
- [ ] Mobile: rebuilt APK, tested on emulator — no crash, auto-fit
      works (or falls back cleanly), enhance attire works
- [ ] `CLAUDE.md` updated with both features
- [ ] Desktop installer rebuilt
- [ ] Mobile APK final rebuild + delivered to user

## ⚠️ Important finding, not yet resolved (2026-08-20)

Mobile testing (`PrintPixLean` AVD, Android 8.1) hit a **real, severe
bug — pre-existing, not introduced by this feature**: dynamic
`import()` syntax throws `Uncaught SyntaxError: Unexpected token
import` on this WebView. Confirmed root cause via
`adb shell dumpsys package com.android.webview`: this AVD's WebView is
**Chromium 61.0.3163.98** — dynamic `import()` wasn't added until
**Chrome 63** (Dec 2017). This AVD is a Play-Store-less AOSP image
(chosen for emulator *stability*, see "Self-testing the Android build"
below), so its WebView is frozen at whatever shipped with Android 8.1
in 2017 and never auto-updates the way a real Play-Store-enabled
device's WebView does.

**This isn't just a problem for the new auto-fit/auto-enhance
features** — `bgRemoval.js` (Remove Background) already uses
`await import('https://esm.run/@imgly/background-removal')`, so it
hits the exact same syntax error, and the resulting cascading
`ReferenceError: BgRemoval is not defined` in `app.js`'s init sequence
risks breaking module initialization beyond just Remove Background,
since `app.js` calls each module's `.init()` in a fixed order. Round
3's earlier "confirmed working" test only proved `fetch()` reachability
(CORS/file-access), not that `import()` itself parses — a real gap in
that verification, found only now.

**Real-world risk is likely low but not zero**: actual Android phones
with Google Play Services get WebView updates independently of the OS
version, so most real 2017+ devices in active use today would have a
far newer WebView than this frozen-at-ship-date AOSP emulator. Risk is
concentrated in devices without Play Services (some China-market
Android, certain custom ROMs) or very old/abandoned devices that never
received a single WebView update.

**Not yet decided**: whether to (a) ship as-is and treat this as a
documented known-limitation matching this project's existing "the
emulator isn't representative of real devices" caution, (b) rework the
CDN-loading pattern to avoid dynamic `import()` for broader
compatibility (affects `bgRemoval.js` too, not just this feature — a
bigger scope than what was asked for), or (c) something else. Flagged
to the user for a decision before finalizing mobile delivery.

## Session log

- **2026-08-12**: Design approved by user. This file created. Starting
  implementation with `poseDetection.js` (desktop).
- **2026-08-12** (continued): Desktop implementation complete —
  `poseDetection.js`, `attireEnhance.js` written; `canvasEditor.js`'s
  `alignAttireToPhoto()` rewritten (async, pose-detection-first with
  heuristic fallback) + new `getAttireElement()` export; `attireControls.js`
  wired for both features' loading/progress UI; `index.html` markup +
  script tags added. Swapped the enhance model mid-research: originally
  planned XLSR (~172KB) turned out to live in a **gated/private** HF
  repo (`aplux/XLSR`, confirmed 401 via direct curl) — replaced with
  `Xenova/swin2SR-classical-sr-x2-64` (~19MB `uint8` variant, confirmed
  public) via `@huggingface/transformers`.
- **2026-08-12** (continued): Desktop tested in Browser pane.
  **Auto-fit worked on the first real test** — confirmed via genuine
  MediaPipe engine console logs (not just app-level state) and a
  plausible computed attire transform. **Auto-enhance needed two real
  fixes found during testing**:
  1. `std::bad_alloc` from onnxruntime-web — the model can't handle a
     full-resolution attire image (tested: 640x640) in one shot. Fixed
     by capping the longest edge at `MODEL_INPUT_SIZE = 256` before
     feeding the model (never upscaling smaller images first).
  2. `resultCanvas.toDataURL is not a function` — `output.toCanvas()`
     returns an `OffscreenCanvas` (no `toDataURL()`), not a real
     `HTMLCanvasElement`. Fixed by redrawing it onto a real `<canvas>`
     via `drawImage()` before returning.
  After both fixes, isolated pipeline testing (importing the library,
  loading the pipeline, running inference directly via `javascript_tool`
  rather than through the real button, so the slow one-time setup could
  be timed/observed in stages) confirmed correct behavior end-to-end:
  module import ~10s, model download ~57s, one-time WASM/ONNX session
  compile ~87s, actual inference on a tiny 64x64 test image <15s —
  **all in this constrained sandboxed dev VM**, which is not
  representative of real user hardware (same caveat this project
  already applies to its Android emulator — see CLAUDE.md). Total
  first-use cost here was ~3 minutes; updated the UI hint text to set
  that expectation ("can take a minute or more... faster after this")
  rather than assume real hardware will match this sandbox's speed.
  Confirmed the final code loads with zero console errors. Proceeding
  to port both features to `mobile/`.
