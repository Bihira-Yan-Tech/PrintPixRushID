/**
 * Electron main process.
 * Wraps the existing plain HTML/CSS/JS app (index.html + js/modules/*)
 * in a native desktop window — no code changes to the web app itself
 * for most features, this just loads the same index.html that already
 * worked standalone in a browser, via loadFile() instead of a URL bar.
 *
 * Renderer stays locked down (nodeIntegration off, contextIsolation on
 * — the app has no need for Node/Electron APIs from the page itself,
 * it's plain DOM/canvas/localStorage code for everything except Save
 * Job's file dialog, which needs `preload.js`'s narrow bridge — see
 * below and CLAUDE.md's "Desktop app (Electron)" section).
 */
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    icon: path.join(__dirname, '..', 'assets', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null); // no File/Edit/View menu bar — this isn't a document-editor-style app
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

/**
 * Save Job's real "Save As" dialog. The renderer's own attempt at the
 * browser's File System Access API (`showSaveFilePicker`) didn't
 * reliably surface a dialog under Electron's file:// origin — rather
 * than keep chasing why, this uses Electron's own `dialog`/`fs` APIs,
 * which are the standard, always-reliable way to get a native Save
 * dialog in an Electron app. `saveRecopy.js` (desktop copy only) calls
 * this via `window.electronAPI.saveJobFileAs` when present, ahead of
 * the browser-API/download fallbacks it already has for when the app
 * runs in a plain browser tab instead of Electron.
 */
ipcMain.handle('save-job-file-as', async (event, { data, suggestedName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName,
    filters: [{ name: 'PrintPix Rush ID job', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: String((err && err.message) || err) };
  }
});

/** The saved-jobs list's "Save" button: silently overwrites an already-chosen path, no dialog. */
ipcMain.handle('write-job-file', async (event, { filePath, data }) => {
  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS convention: re-open a window when the dock icon is clicked
    // and no windows are open. Harmless no-op on Windows/Linux.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
