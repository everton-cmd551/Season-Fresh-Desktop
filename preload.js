// ═══════════════════════════════════════════════════════════════════════
// Preload Script — Season Fresh Desktop Shell
// ═══════════════════════════════════════════════════════════════════════
// Exposes a minimal, security-scoped API to the renderer via contextBridge.
// NO filesystem, NO shell, NO arbitrary IPC command execution.
//
// Credential management uses IPC invoke (request/response) — the renderer
// can only call these specific named channels. The main process handles
// all encryption/decryption via safeStorage (Windows DPAPI).
// ═══════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  // Read-only metadata
  platform: process.platform,
  arch: process.arch,
  isDesktop: true,

  // ── CREDENTIAL MANAGEMENT (IPC → Main Process) ─────────────────────
  // Save credentials — encrypted via Windows DPAPI before hitting disk
  saveCredentials: (email, password) =>
    ipcRenderer.invoke('credentials:save', email, password),

  // Load saved credentials — decrypted in main process, returned to renderer
  getCredentials: () =>
    ipcRenderer.invoke('credentials:get'),

  // Clear saved credentials from disk
  clearCredentials: () =>
    ipcRenderer.invoke('credentials:clear'),
});
