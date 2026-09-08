# PROGRESS.md — AI Formal-Attire Assistant + Multi-Provider Model Settings

Tracking doc for an in-progress feature build. **Read this file first**
if you're picking this up in a new session/agent. Root project doc is
`CLAUDE.md` — read that too if unfamiliar with the app.

Full plan (context, decisions, architecture) lives at the plan file this
session wrote: it's not checked into the repo, so the summary below is
the durable record — treat this file as the source of truth going
forward, not the plan file.

## The ask (superseded an earlier decision)

User asked for a full system review, then a much bigger feature: real
AI-generated formal attire (not the old manual overlay/heuristic), a
Settings panel to manage multiple AI provider API keys (Gemini, Groq,
OpenRouter, HuggingFace, Pollinations, Qwen, Dola, custom), live
testing of those keys with model discovery, automatic free-model-first
routing at generation time, and a GUI change: remove the old "Formal
attire" toggle, replace with Command Options (gender select + one "Add
Formal Attire" button).

This explicitly reverses `CLAUDE.md`'s earlier "Known simplifications"
entry that ruled out real virtual try-on as impossible without a paid
backend — it's now in scope because the user is supplying their own
free-tier provider API keys directly, and the native-bridge pattern
already in this app (Electron IPC / Android bridge) solves the CORS/
key-exposure problem without needing a dedicated backend server.

## Decisions confirmed with the user
- Old manual attire system (toggle, illustrations, upload/opacity/
  align/enhance) is **removed entirely**, not kept as fallback.
- API keys stored locally, unencrypted (same trust model as saved
  jobs — see `CLAUDE.md`'s Security note).
- Desktop first, then port to mobile.
- Provider list is extensible (a "Custom/OpenAI-compatible" type),
  not hardcoded to only the named providers.

## Research findings (Sept 2026, see also modelProviders.js's own doc comment)
- **Groq**: LLM/audio inference only, no image generation/editing —
  listed but excluded from the image-edit routing pool.
- **Gemini** (Google AI Studio): real image editing, genuine free
  quota, well-documented `generateContent` API with inline base64
  image input — the most confidently-correct integration here.
- **OpenRouter**: aggregator, real `/models` endpoint reports pricing
  (`:free` suffix / $0 = free) — used for both listing and routing.
- **Pollinations.ai**: no API key needed, pre-registered by default.
  **Its real image-to-image API (`kontext` model) needs a *publicly
  hosted* image URL it can fetch itself — NOT inline base64/a data:
  URI** (verified against its real APIDOCS.md via WebFetch, and by
  directly testing a wrong guessed endpoint that returned HTTP 200 but
  silently ignored the image). Since this app has no backend to host a
  photo at a public URL, Pollinations **cannot do the actual edit
  step** — `buildEditRequest()` in `modelProviders.js` throws a clear,
  immediate, honest error explaining this instead of making a network
  call that's guaranteed to fail unhelpfully. It's still useful as a
  zero-setup, always-real "Test" target (its `/models` endpoint is
  real and was verified working), and may become usable later if this
  app ever gains a way to get a public URL for the photo.
- **Hugging Face Inference API**: free/rate-limited, real `whoami-v2`
  token-validation endpoint used for Test; the image-edit request
  shape is best-effort (varies per model) — HF sometimes returns raw
  image bytes instead of JSON, handled generically in `callHttp()`.
- **Qwen/DashScope**: best-effort preset, unverified request/response
  shape (no key available to test this session) — flagged honestly in
  code comments, not presented as more solid than it is.
- **Dola**: turned out to be a consumer chat/image app with unclear
  public image-edit API docs — deliberately NOT given a hardcoded
  integration; available via the generic Custom provider type instead.
- **OmniRoute** (added after the user asked for it specifically): a
  self-hosted, open-source AI gateway (`npm i -g omniroute`, default
  port 20128, OpenAI-compatible `/v1`). Needs a user-supplied `baseUrl`
  — see Custom-preset-style handling in `modelProviders.js`.

## Real bugs found via live testing with real API keys (Sept 2026)
All fixed and committed — kept here since they're non-obvious and the
kind of thing worth not re-discovering:
1. **Electron's `ai-provider-call` IPC handler always used `require('https')`**
   regardless of the target URL's protocol — threw `ERR_INVALID_PROTOCOL`
   for a local `http://localhost:20128` OmniRoute instance. Fixed to
   pick `http` vs `https` off the URL itself.
2. **OmniRoute preset double-prefixed `/v1/`** — hardcoded its own
   `/v1/models` suffix on top of a `baseUrl` the user had already given
   as `http://localhost:20128/v1`, producing `/v1/v1/models`. Fixed to
   match the "custom" preset's convention: `baseUrl` is the full API
   root (OpenAI-SDK-`baseURL`-style), endpoints just append directly.
3. **The Add Provider form was missing a Base URL field entirely** —
   the Custom/OmniRoute presets need one (`needsBaseUrl: true`) but
   `index.html`/`providerSettings.js` never rendered it, so `baseUrl`
   was always sent as `''`. Added the field + show/hide wiring.
4. **`api-inference.huggingface.co` (the Hugging Face preset's URL) is
   fully decommissioned** — doesn't even resolve via DNS anymore.
   Fixed to `router.huggingface.co`, HF's current Inference Providers
   gateway. Also fixed the request body, which had `inputs`/
   `parameters` backwards (was sending the prompt as `inputs` and the
   image under a made-up `parameters.image` field — real shape is
   `inputs` = base64 image, `parameters.prompt` = text).
   **Still not fully solved**: unlike chat completions (a real,
   working, provider-agnostic route), HF image-to-image has no unified
   cross-provider endpoint — confirmed via HF's own
   `inferenceProviderMapping` API that `Qwen/Qwen-Image-Edit` is only
   hosted by third-party partners (fal-ai/replicate/wavespeed), not
   HF's own compute, and each partner needs its own undocumented
   request shape when called via raw HTTP (only their client SDK
   handles this correctly today). Left as a real, correct route
   (better than the previously-dead domain) with an honest comment —
   don't assume Hugging Face works end-to-end without testing the
   specific model chosen.
5. **OpenRouter/OmniRoute/Custom presets never set `max_tokens`** —
   OpenRouter defaults to the model's own maximum for chat completions
   (observed requesting 58,000+ tokens for some image models), which
   many accounts' credit balance can't afford even though an image
   response itself needs nowhere near that many tokens. Surfaced as a
   confusing `HTTP 402 "requires more credits"` that looked like an
   account problem but was actually just an oversized default request.
   Fixed by capping `max_tokens: 4096` on all three presets' edit
   requests.
6. Two account-level (not code) blockers hit during testing, both
   worth remembering as the kind of thing to check first next time:
   Google AI Studio projects can have `limit: 0` free-tier quota for
   image-generation models specifically even with a working key
   (needs billing linked to unlock); OpenRouter returns a misleading
   `401 "User not found"` (not `402`/a clear credits message) when the
   account has no credits/payment method — fixed once the user added
   credits.

## Architecture
Real HTTP calls (test + edit) go through a native bridge when
available — Electron's `ai-provider-call` IPC handler (main process,
not subject to browser CORS) or, on mobile, a planned
`AndroidBridge.callProvider` (not yet added — see Mobile section
below) — falling back to plain browser `fetch()` otherwise. This
mirrors the exact pattern this app already uses for Save Job
(`electronAPI.saveJobFileAs` / `AndroidBridge.saveFileAs`). See
`modelProviders.js`'s own top-of-file comment for the full write-up.

Generation result replaces the photo's own pixels directly (via the
existing `CanvasEditor.setEnhancedPhoto()`, same mechanism Auto
Enhance uses) rather than adding a second draggable overlay object —
there's no longer a separate "attire" Fabric object at all.

## Checklist

### Desktop
- [x] `modelProviders.js` — provider registry, storage, real HTTP
      test/edit calls, "Fill First" free-before-paid candidate sort
- [x] Electron `ai-provider-call` IPC handler + preload bridge method
- [x] `providerSettings.js` + modal markup — add/test/delete providers
- [x] `aiAttireAssistant.js` — the generation pipeline with fallback chain
- [x] Old attire system removed: `attireControls.js`, `attireEnhance.js`,
      `attireRenderer.js` (trimmed survivor: `faceFitHeuristic.js`,
      keeps `computeFaceFitCrop()` for the unrelated Auto-fit face
      button), `poseDetection.js` all deleted; `canvasEditor.js`'s
      attire-object machinery (Layers list, `setAttireObject`,
      `alignAttireToPhoto`, etc.) removed
- [x] `formalAttireCommand.js` + new Command Options UI (gender toggle
      + "Add Formal Attire" button) in `index.html`
- [x] Real testing via Browser pane:
      - All modules load with zero console errors
      - Real network round-trip to Pollinations' `/models` endpoint
        (genuine `testProvider()` pass, real model list returned)
      - Full real UI flow: upload a photo -> click "Add Formal
        Attire" -> candidate loop runs -> honest, specific failure
        message shown ("Pollinations needs a public image URL...")
      - Provider Settings modal: add/test/delete all verified against
        real `ModelProviders` storage via real DOM clicks
      - **Found + fixed a real pre-existing bug** during this testing:
        Add Formal Attire / Auto Enhance / Remove Background only ever
        re-enabled via `upload:change` (fires on a brand-new upload),
        never after restoring a job (autosave/Open Job/Recopy/Import
        don't fire it — the original `File` doesn't survive a save/
        reload) — all three stayed permanently disabled after
        "Continue where you left off" despite a photo being loaded.
        Fixed in `formalAttireCommand.js`/`autoEnhance.js` (new
        `job:applied` listener) and `bgRemoval.js` (`syncUI()` now
        also sets `removeBgBtn.disabled`).
- [x] **Happy-path verified — a real successful generation.**
      Tested with the user's own real Gemini, OpenRouter, and Hugging
      Face keys (see "Real bugs found via live testing" above for what
      each one hit and how it was fixed/diagnosed). Gemini blocked by
      `limit: 0` account quota (needs billing linked); Hugging Face
      blocked by the third-party-provider routing gap; **OpenRouter
      succeeded end-to-end** once the user added account credits and
      the `max_tokens` bug was fixed — clicking "Add Formal Attire" on
      a test photo produced a real, photorealistic generated image of
      the subject wearing a formal business suit, confirmed visually
      (not just a status-text check).
- [x] `git commit` — done, multiple commits through this whole pass
      (see git log)

### Mobile (Sept 9, 2026 pass)
- [x] Ported `modelProviders.js`, `aiAttireAssistant.js`,
      `formalAttireCommand.js`, `providerSettings.js`,
      `faceFitHeuristic.js` to `mobile/js/modules/` (copied as-is from
      desktop — no mobile-specific changes needed in these files)
- [x] Deleted the superseded mobile files: `attireControls.js`,
      `attireEnhance.js`, `attireRenderer.js`, `poseDetection.js`
- [x] Ported `canvasEditor.js` (desktop's fully-updated version, with
      mobile's own `MIN_ZOOM`/`INITIAL_ZOOM = 0.10` and
      `applyZoom(INITIAL_ZOOM)` re-applied on top — verified via diff
      before/after, not just copy-pasted blind), `app.js` (straight
      copy — no mobile-specific lines existed there), `index.html`
      (straight copy of desktop's, then re-applied mobile's 3 zoom-
      default strings: `zoomLabelText` 10%, `previewZoomLabel` 25%,
      `zoomRange` min/value 10). Also ported the `job:applied`
      button-reenable fix to `autoEnhance.js`/`bgRemoval.js` (mobile
      never had it — straight copies) and removed the now-dead
      `AttireControls.syncUI(job.photo)` call from `saveRecopy.js`
      (mobile's own AndroidBridge save-flow code left untouched).
- [x] Added `AndroidBridge.callProvider(requestId, method, url,
      headersJson, body)` to `MainActivity.java` — real HTTP via
      `java.net.HttpURLConnection` on its own background `Thread`
      (never the UI thread or the JS-bridge thread — a generation call
      can take several seconds), posts back through
      `window.__androidProviderCallback` exactly matching
      `modelProviders.js`'s `androidCallProvider()` contract. Mirrors
      Electron's `ai-provider-call` IPC handler's image/* → base64
      convention so `callHttp()` treats either bridge's result
      identically. **Known gap** (not hit by any shipped preset):
      `AndroidManifest.xml`'s `usesCleartextTraffic="false"` blocks a
      plain-`http://` custom provider (e.g. local OmniRoute) on mobile
      — documented honestly in `CLAUDE.md`, not fixed (every real
      preset uses `https://`).
- [x] Rebuilt via `npm run build:apk:manual` — clean build, all 10
      `.class` files (including the new `AndroidBridge$4.class` for
      `callProvider`'s own anonymous `Thread`/`Runnable`) correctly
      dexed by the existing glob-based dexing step. APK installs and
      launches successfully; screenshot confirms the new UI renders
      correctly (header, startup gate, and critically the mobile-only
      "25%"/"10%" zoom defaults are visible, confirming the port's
      zoom-constant changes actually took effect).
      **Testing was hampered by severe emulator instability this
      session** — the `PrintPixTest` AVD's system_server crashed with
      `DeadSystemException` mid-session (unrelated to any app code —
      happened before our app was even launched) and, after a reboot
      and a full wipe-data cold restart, the system as a whole became
      unresponsive enough that a single tap took 6+ minutes to not
      register and `uiautomator dump` returned "null root node". This
      matches (and is worse than) `CLAUDE.md`'s own pre-existing
      "This emulator is unreliable in this dev environment" note — real
      device testing remains the trustworthy signal for anything beyond
      "does it build, install, and render", which is as far as this
      session could push it before the environment became unusable.
      No `FATAL EXCEPTION` was ever logged for `com.printpixrushid.app`
      itself at any point.

### Docs / delivery
- [x] Updated `CLAUDE.md`: replaced the old Formal Attire /
      "Known simplifications" write-up with the new AI Assistant +
      Provider Settings system throughout (Architecture bullets,
      Custom events, Design system, Known simplifications, Status vs.
      spec, and the Mobile app (Android) bridge section); corrected the
      (confirmed-wrong) claim that WebView JS console output doesn't
      reach `adb logcat` — it does, via `chromium: [INFO:CONSOLE(...)]`
      entries.
- [x] Rebuilt the desktop installer — `PrintPix Rush ID Setup 1.0.0.exe`
      (~80MB), built clean via `npm run dist`.
- [x] Final mobile APK rebuilt — `PrintPixRushID-signed.apk`, installs
      and launches correctly (see emulator caveat above).

## Review punch-list (from the "review muna" ask, folded into this pass)
1. ~~No git repo for this project~~ — **fixed**: `git init` +
   baseline commit done as step 0. Also caught and fixed a real
   `.gitignore` anchoring bug in the same pass: `android/keystore/`
   etc. were written relative to repo root but the actual Android
   project lives at `mobile/android/`, so the signing keystore and
   APK build output were about to get committed unignored — fixed to
   `**/android/keystore/` etc.
2. ~~Buttons not re-enabling after job restore~~ — **fixed**, see above.
3. Still open, not addressed this pass (pre-existing, unrelated to
   this feature, flagged in the prior effort's now-archived tracking
   below): mobile WebView dynamic-`import()` incompatibility
   (`bgRemoval.js`'s Remove Background) on old/un-updated Android
   WebView.
4. Desktop installer stale (see checklist above).
5. Mobile's temporary self-test `<script>` block (from the prior
   effort) — needs checking/removal during the mobile port pass, since
   the modules it tested (`poseDetection.js`, `attireEnhance.js`) are
   being deleted anyway.

---

## Superseded: previous tracking doc ("Attire Auto-Fit & Auto-Enhance")

Everything below this line is the **old** progress doc for the manual
attire system's "Align to Photo"/pose-detection auto-fit and Swin2SR
attire-image upscaling work — that whole system has now been **removed
and replaced** by the AI Formal-Attire Assistant tracked above. Kept
here for historical context (e.g. why `poseDetection.js`/
`attireEnhance.js` existed and what bugs they'd already hit) — not
an active checklist anymore.

### The ask (superseded)
User reported "Align to Photo" (attire positioning) and attire image
quality weren't good enough. Wanted real shoulder-position detection
for auto-fit, and a sharpen/upscale pass for low-res uploaded attire
PNGs.

### Chosen approach (superseded)
- **Auto-fit** → MediaPipe Pose Landmarker (`poseDetection.js`),
  CDN-lazy-loaded, shoulder-keypoint-based repositioning with a
  heuristic fallback.
- **Auto-enhance (attire)** → `Xenova/swin2SR-classical-sr-x2-64` via
  `@huggingface/transformers` (`attireEnhance.js`), CDN-lazy-loaded.
- Both explicitly framed as "smarter positioning"/"sharper image," NOT
  AI-generated photorealistic virtual try-on — that was still
  considered out of scope for a no-GPU/free/no-backend app at the time.

### Real bugs found & fixed during that effort (kept for reference)
- `std::bad_alloc` in onnxruntime-web from feeding a full-resolution
  attire image directly into Swin2SR — fixed by capping input to 256px
  on the longest edge.
- `output.toCanvas()` from `@huggingface/transformers` returns an
  `OffscreenCanvas` (no `toDataURL()`) — fixed by redrawing onto a
  real `<canvas>`.
- Stale `.claude/launch.json` after the project folder moved from
  `D:\PrintPixRushID\` to
  `D:\Claude Code Projects\Bihira Yan Projects\PrintPixRushID\`.
- `mobile/scripts/build-apk-manual.ps1`'s hardcoded Android SDK path
  (`D:\android-sdk`) after the SDK also moved to
  `D:\Claude Code Projects\android-sdk`.

### Unresolved finding from that effort (still open — see punch-list above)
Mobile testing on the `PrintPixLean` AVD (Android 8.1, Chromium 61)
found dynamic `import()` throws `Uncaught SyntaxError: Unexpected
token import` — Chrome 63 added dynamic-import support, so this
WebView (frozen at whatever shipped with the OS, no Play Services auto
-update on this specific AOSP emulator image) predates it. This
affected `poseDetection.js`/`attireEnhance.js` (now deleted) but ALSO
the still-shipping `bgRemoval.js` (Remove Background) — real risk is
believed low (real Play-Store-enabled phones get independent WebView
updates) but was never fully resolved. Real-world device fleet
assumptions would need confirming with the user before investing in a
fix (reworking the CDN-loading pattern to avoid dynamic `import()`
broadly).
