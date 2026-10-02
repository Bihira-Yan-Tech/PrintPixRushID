# Third-party notices

PrintPix Rush ID's own source code is MIT licensed (see `LICENSE`). It uses
the following third-party software, each under its own license.

## Bundled in this repository

| Component | Version | License | Where |
|---|---|---|---|
| [Fabric.js](https://github.com/fabricjs/fabric.js) | 6.4.3 | MIT | `desktop/vendor/`, `mobile/vendor/` |
| [jsPDF](https://github.com/parallax/jsPDF) | 4.2.1 | MIT | `desktop/vendor/`, `mobile/vendor/` |

The original license headers are preserved inside the vendored files.

## Build-time only (not shipped as source in this repo)

| Component | License |
|---|---|
| [Electron](https://www.electronjs.org/) | MIT |
| [electron-builder](https://www.electron.build/) | MIT |
| [Capacitor](https://capacitorjs.com/) (optional Gradle build path) | MIT |

The Windows installer necessarily contains Electron/Chromium, which carry
their own bundled third-party licenses (see `LICENSES.chromium.html` inside
an installed copy of the app).

## Loaded at runtime from the network (NOT bundled or redistributed here)

| Component | License | Notes |
|---|---|---|
| [@imgly/background-removal](https://github.com/imgly/background-removal-js) | **AGPL-3.0** | Powers the **Remove background** button. Loaded on first use from a public CDN (`esm.run`); the repo does not contain or redistribute it. IMG.LY also offers a separate commercial license. If you ever self-host or bundle this library or its models, you take on AGPL-3.0 obligations — review them first. |
| [Google Fonts](https://fonts.google.com/) (Space Grotesk, Inter, IBM Plex Mono) | SIL OFL 1.1 | Loaded from Google's CDN by the UI. |

## AI providers

**Add Formal Attire** sends the photo you are editing to the AI provider(s)
*you* configure (Gemini, OpenRouter, Hugging Face, etc.) using *your own* API
keys. Each provider's terms of service and content policies apply to that
traffic. No keys or photos are sent anywhere else.
