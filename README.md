# PrintPix Rush ID

ID-photo layout and print tool for print shops: upload a customer's photo,
frame it, clean it up, pick one or more ID sizes (1×1, 2×2, 1.5×1.5,
passport, custom), arrange copies on a sheet, and print or export a PDF.
Runs on **Windows (desktop app)** and **Android (APK)**, and also works as a
plain web page.

Plain HTML/CSS/JavaScript — no framework, no build step for the web app
itself.

## Features

- **Page setup** — 2R–8R, A4, Letter, Legal or custom sheet size, portrait/landscape
- **Upload & edit** — drag/resize framing, Undo/Redo, brush Eraser, one-click
  Auto Enhance (levels/color/sharpen), Remove Background with solid or image backgrounds
- **Add Formal Attire (AI)** — Male/Female button that asks an AI image-editing
  model to put the subject in formal attire (see [AI providers](#ai-providers))
- **ID sizing** — mix several sizes on one sheet, optional name-tag bar
- **Live preview, print & PDF** — cutting guides, tight packing, watermark/proof
  overlay, print preview at actual size, 300 PPI PDF export
- **Save Job** — save/restore a whole job (settings + edited photo) to a `.json`
  file you can move to another computer or phone; autosave recovers work after a crash
- Works offline for everything except Remove Background (first use only) and Add Formal Attire

## Download

Grab the latest Windows installer (`.exe`) and Android APK from the
[Releases](../../releases) page.

- **Windows** — run the installer. It is not code-signed, so SmartScreen may
  show "Windows protected your PC" → *More info* → *Run anyway*.
- **Android** — allow "install from unknown sources" for your file manager/browser, then open the APK.
  It is signed with a self-made key, so Play Protect may warn once.

## AI providers

*Add Formal Attire* does not run a model locally. Open **AI Providers**
(header icon), add your own API key for one or more providers, press **Test**,
and the app tries your working providers automatically (free models first).
Keys are stored **locally, unencrypted** on your device (same trust model as
saved jobs) and are only ever sent to the provider they belong to.

| Provider | Notes |
|---|---|
| Google Gemini (AI Studio) | Image editing; free tier needs billing/quota enabled on the Google project for image models |
| OpenRouter | Works end-to-end; many image-capable models, some free |
| Hugging Face | Test works; image-edit routing to partner providers is best-effort |
| Qwen / DashScope, OmniRoute, Custom (OpenAI-compatible) | Best-effort presets |
| Pollinations | Test only — its edit API needs a public image URL, which a local app cannot provide |
| Groq | Listed, but has no image generation/editing |

Pasting a key auto-selects the matching provider. Saved providers can be edited
in place (pencil icon). On Android, plain `http://` provider URLs are blocked by
the app's network policy — use `https://`.

## Development

Two independent copies of the app live side by side (they share ideas, not files):

```
desktop/   web app + Electron wrapper (Windows installer)
mobile/    web app + Android WebView shell (APK)
```

### Run the web app

Serve either folder with any static server (opening `index.html` via `file://`
can block `localStorage`):

```bash
cd desktop
python -m http.server 8000      # then open http://127.0.0.1:8000
```

### Run / build the Windows app

```bash
cd desktop
npm install
npm start          # dev window
npm run dist       # installer -> desktop/dist-installer/
```

### Building the Android APK

`mobile/scripts/build-apk-manual.ps1` builds with the raw Android SDK tools
(no Gradle). You need the Android SDK (platform 34, build-tools 34.0.0) and JDK 17.

```powershell
$env:PRINTPIX_KEYSTORE_PASSWORD = "<your keystore password>"
# optional overrides if your paths differ:
# $env:PRINTPIX_ANDROID_SDK = "C:\path\to\android-sdk"
# $env:PRINTPIX_JDK17       = "C:\path\to\jdk-17"
cd mobile
npm run build:apk:manual     # -> mobile/manual-apk/build/PrintPixRushID-signed.apk
```

The signing keystore (`mobile/android/keystore/`) is intentionally **not** in
this repo. Create your own:

```bash
keytool -genkeypair -v -keystore mobile/android/keystore/printpix-release.keystore \
  -alias printpixrushid -keyalg RSA -keysize 2048 -validity 10000
```

`CLAUDE.md` has the deep architecture notes, known limitations, and the history
of real bugs found and fixed; `PROGRESS.md` tracks the latest audit.

## Privacy & security notes

- No backend, no accounts, no telemetry.
- Photos stay on your device except when you press *Add Formal Attire* (sent to your chosen AI provider) or *Remove background* (the model is downloaded; the photo is processed locally).
- API keys and saved jobs are stored in plain `localStorage` — don't use on a shared/public machine.

## License

[MIT](LICENSE) © 2026 Bihira Yan Tech.
Third-party components and their licenses (notably the AGPL-3.0
`@imgly/background-removal`, loaded at runtime and not bundled) are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
