/**
 * Preload script — the only bridge between the sandboxed renderer (the
 * plain web app, contextIsolation: true / sandbox: true) and anything
 * Node/Electron-side. Exposes a minimal `window.electronAPI` with just
 * enough surface for a real native "Save As" dialog, since the browser's
 * own File System Access API turned out not to reliably show one under
 * Electron's file:// origin (see CLAUDE.md's "Desktop app (Electron)"
 * section) — Electron's own dialog+fs IPC is the well-documented,
 * always-reliable way to get this in an Electron app, so this exists
 * specifically to route around that gap rather than keep guessing at
 * why the web API didn't behave the same as in a real browser tab.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Opens a native Save dialog; writes `data` to wherever the user picks. */
  saveJobFileAs: (data, suggestedName) => ipcRenderer.invoke('save-job-file-as', { data, suggestedName }),
  /** Overwrites an already-chosen path with no dialog (the "Save" button's silent re-save). */
  writeJobFile: (filePath, data) => ipcRenderer.invoke('write-job-file', { filePath, data }),
});
