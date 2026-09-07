/**
 * Copies this mobile app's own source files (index.html, css/, js/,
 * vendor/, assets/ — at mobile/, one level up from this script) into
 * mobile/www/, which is what Capacitor's webDir points at for the
 * Android build.
 *
 * mobile/ is its own independent copy of the app — NOT synced from
 * desktop/ automatically. desktop/ and mobile/ started identical but
 * are expected to diverge over time (touch-friendly tweaks, different
 * defaults, mobile-only fixes like the WebView file-chooser shim) — see
 * CLAUDE.md's "Two independent copies" note for why they were split.
 * www/ itself is still a generated, gitignored copy of mobile/'s own
 * files, not something to edit directly — edit mobile/index.html etc.,
 * then run this (via `npm run sync:mobile`, which also runs
 * `cap sync`, or `npm run build:apk`/`build:apk:manual` which call it
 * for you) before rebuilding the APK.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

copyRecursive(path.join(ROOT, 'index.html'), path.join(WWW, 'index.html'));
for (const dir of ['css', 'js', 'vendor', 'assets']) {
  copyRecursive(path.join(ROOT, dir), path.join(WWW, dir));
}

console.log('Synced root app files into www/');
