// ═══════════════════════════════════════════════════════════════════════
// Season Fresh ERP — Electron Desktop Shell (Thin Client)
// ═══════════════════════════════════════════════════════════════════════
// This is a security-hardened wrapper. It contains NO ERP business logic.
// It loads the live Vercel production URL and manages auto-updates via
// GitHub Releases.
// ═══════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, dialog, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');

// ── CONFIGURATION ─────────────────────────────────────────────────────
const PRODUCTION_URL = 'https://season-fresh.vercel.app';
const ALLOWED_HOSTS = [
  'season-fresh.vercel.app',
  'season-fresh-*.vercel.app',  // Preview deployments
  'vercel.live',                // Vercel toolbar
];

// ── LOGGING ───────────────────────────────────────────────────────────
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

let mainWindow = null;

// ── SINGLE INSTANCE LOCK ──────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────
function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.some(host => {
      if (host.includes('*')) {
        const pattern = host.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(parsed.hostname);
      }
      return parsed.hostname === host;
    });
  } catch {
    return false;
  }
}

// ── WINDOW CREATION ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'Season Fresh ERP',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: !app.isPackaged,
    },
  });

  // Maximize on launch for dashboard-heavy UI
  mainWindow.maximize();
  mainWindow.show();

  // ── LOAD PRODUCTION URL ───────────────────────────────────────────
  mainWindow.loadURL(PRODUCTION_URL);

  // ── NAVIGATION LOCK ───────────────────────────────────────────────
  // Block navigation to any URL outside the allowed hosts
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedUrl(navigationUrl)) {
      event.preventDefault();
      log.warn(`Blocked navigation to: ${navigationUrl}`);
    }
  });

  // ── NEW WINDOW LOCK ───────────────────────────────────────────────
  // Open external links (e.g. document viewer) in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── ZOOM CONTROLS (Ctrl + / Ctrl - / Ctrl 0) ──────────────────────
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Only intercept events when Ctrl (or Cmd on Mac) is pressed
    if (input.control || input.meta) {
      if (input.key === '=' || input.key === '+') {
        const currentZoom = mainWindow.webContents.getZoomFactor();
        mainWindow.webContents.setZoomFactor(currentZoom + 0.1);
        event.preventDefault();
      } else if (input.key === '-') {
        const currentZoom = mainWindow.webContents.getZoomFactor();
        mainWindow.webContents.setZoomFactor(currentZoom - 0.1);
        event.preventDefault();
      } else if (input.key === '0') {
        mainWindow.webContents.setZoomFactor(1.0);
        event.preventDefault();
      }
    }
  });

  // ── OFFLINE FALLBACK ──────────────────────────────────────────────
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log.error(`Page load failed (${errorCode}): ${errorDescription}`);
    mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  });

  // ── CONTENT SECURITY POLICY ───────────────────────────────────────
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' https://season-fresh.vercel.app https://*.vercel.app; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://season-fresh.vercel.app https://*.vercel.app; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://season-fresh.vercel.app https://*.vercel.app; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: blob: https:; " +
          "connect-src 'self' https://season-fresh.vercel.app https://*.vercel.app https://*.neon.tech wss://*.neon.tech;"
        ],
      },
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── AUTO-UPDATE LIFECYCLE ─────────────────────────────────────────────
// PRIVATE REPO AUTHENTICATION:
// Since the Season-Fresh-Desktop repo is private, the auto-updater needs
// a read-only GitHub Personal Access Token (PAT) to download release assets.
//
// Security Model:
// - This token has READ-ONLY access (Fine-Grained PAT with "Contents: Read")
// - It is embedded in the compiled .exe binary — not visible in plain text
// - Only 10 internal staff have the installer
// - The token CANNOT push code, create releases, or modify the repo
//
// To generate: GitHub → Settings → Developer Settings → Fine-grained tokens
// → New token → Repository: Season-Fresh-Desktop → Permissions: Contents (Read)
// Then replace the placeholder below with the actual token.
// ──────────────────────────────────────────────────────────────────────
// Injected at build time via CI/CD secrets (UPDATER_PAT environment variable).
// This value gets compiled into the binary and never appears in source code.
const UPDATER_TOKEN = process.env.UPDATER_PAT || '';

function setupAutoUpdater() {
  // Only check for updates in production (packaged) builds
  if (!app.isPackaged) {
    log.info('Skipping auto-update check in development mode.');
    return;
  }

  // Configure private repo authentication
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'everton-cmd551',
    repo: 'Season-Fresh-Desktop',
    private: true,
    token: UPDATER_TOKEN,
  });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`Update available: v${info.version}`);
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(
        `document.title = "Season Fresh ERP — Downloading update v${info.version}..."`
      ).catch(() => {});
    }
  });

  autoUpdater.on('update-not-available', () => {
    log.info('Application is up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`Download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Update downloaded: v${info.version}`);
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Season Fresh ERP v${info.version} is ready to install.`,
        detail: 'The application will restart to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-update error:', error);
  });

  // Trigger the first check
  autoUpdater.checkForUpdatesAndNotify();

  // Re-check every 4 hours while the app is running
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
}

// ── APP LIFECYCLE ─────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
