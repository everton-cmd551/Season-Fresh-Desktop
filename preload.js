// ═══════════════════════════════════════════════════════════════════════
// Preload Script — Season Fresh ERP Desktop Shell
// ═══════════════════════════════════════════════════════════════════════
// Exposes a minimal, read-only API to the renderer via contextBridge.
// NO filesystem, NO shell, NO IPC command execution.
// ═══════════════════════════════════════════════════════════════════════

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  // Read-only metadata
  platform: process.platform,
  arch: process.arch,
  isDesktop: true,
});
