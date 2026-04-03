// ═══════════════════════════════════════════════════════════════════════
// Season Fresh — Electron Desktop Shell (Thin Client)
// ═══════════════════════════════════════════════════════════════════════
// This is a security-hardened wrapper. It contains NO ERP business logic.
// It loads the live Vercel production URL and manages auto-updates via
// GitHub Releases.
// ═══════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, dialog, shell, session, safeStorage, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');

// ── CONFIGURATION ─────────────────────────────────────────────────────
const PRODUCTION_URL = 'https://season-fresh.vercel.app';
const ALLOWED_HOSTS = [
  'season-fresh.vercel.app',
  'season-fresh-*.vercel.app',  // Preview deployments
  'vercel.live',                // Vercel toolbar
  '*.public.blob.vercel-storage.com', // Vercel Blob attachments
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

// ══════════════════════════════════════════════════════════════════════════
// CREDENTIAL VAULT — Encrypted at rest via Windows DPAPI / macOS Keychain
// ══════════════════════════════════════════════════════════════════════════
// Security Model:
// 1. Passwords are encrypted using Electron's safeStorage API which delegates
//    to Windows DPAPI — the encrypted blob can ONLY be decrypted by the same
//    Windows user account that encrypted it.
// 2. The encrypted credential file lives in %APPDATA%/season-fresh-desktop/
//    and is NEVER in plain text on disk.
// 3. Browser session data (cookies, localStorage) is still wiped on every
//    launch —  the server always issues a fresh auth token.
// 4. The idle timeout (13min + 2min warning) in the web app still forces
//    re-authentication after inactivity.
// ══════════════════════════════════════════════════════════════════════════

function getCredentialPath() {
  return path.join(app.getPath('userData'), '.credentials.enc.json');
}

function saveCredentials(email, password) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Credential save skipped — OS encryption not available.');
      return false;
    }
    const encryptedPassword = safeStorage.encryptString(password);
    const data = {
      email: email,
      password: encryptedPassword.toString('base64'),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(getCredentialPath(), JSON.stringify(data), 'utf-8');
    log.info(`Credentials saved for ${email}`);
    return true;
  } catch (e) {
    log.error('Failed to save credentials:', e.message);
    return false;
  }
}

function loadCredentials() {
  try {
    const credPath = getCredentialPath();
    if (!fs.existsSync(credPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const decryptedPassword = safeStorage.decryptString(
      Buffer.from(raw.password, 'base64')
    );
    return { email: raw.email, password: decryptedPassword };
  } catch (e) {
    log.error('Failed to load credentials:', e.message);
    // Corrupted file — delete it
    try { fs.unlinkSync(getCredentialPath()); } catch (_) {}
    return null;
  }
}

function clearCredentials() {
  try {
    const credPath = getCredentialPath();
    if (fs.existsSync(credPath)) {
      fs.unlinkSync(credPath);
      log.info('Saved credentials cleared.');
    }
  } catch (e) {
    log.error('Failed to clear credentials:', e.message);
  }
}

// ── IPC HANDLERS (Renderer ↔ Main Process) ────────────────────────────
ipcMain.handle('credentials:save', (_event, email, password) => {
  return { success: saveCredentials(email, password) };
});

ipcMain.handle('credentials:get', () => {
  return loadCredentials();
});

ipcMain.handle('credentials:clear', () => {
  clearCredentials();
  return { success: true };
});

// ── HELPERS ───────────────────────────────────────────────────────────
function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.some(host => {
      if (host.includes('*')) {
        const pattern = host.replace(/\./g, '\\.').replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`, 'i').test(parsed.hostname);
      }
      return parsed.hostname === host;
    });
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LOGIN PAGE CREDENTIAL INJECTION
// ══════════════════════════════════════════════════════════════════════════
// After the login page finishes loading, we:
// 1. Check if saved credentials exist in the vault
// 2. If yes, auto-fill the email + password fields in the DOM
// 3. Hook the form's submit event to capture new/updated credentials
//
// Since the login form uses uncontrolled React inputs with FormData,
// setting .value directly works — FormData reads from the DOM value prop.
// ══════════════════════════════════════════════════════════════════════════

function injectCredentialHelper() {
  const creds = loadCredentials();

  // Build the injection script
  const fillEmail = creds ? JSON.stringify(creds.email) : 'null';
  const fillPassword = creds ? JSON.stringify(creds.password) : 'null';

  const script = `
    (function() {
      var savedEmail = ${fillEmail};
      var savedPassword = ${fillPassword};
      var maxAttempts = 20;
      var attempt = 0;

      function tryInject() {
        attempt++;
        var emailInput = document.querySelector('input[name="email"]');
        var passwordInput = document.querySelector('input[name="password"]');

        if (!emailInput || !passwordInput) {
          if (attempt < maxAttempts) {
            setTimeout(tryInject, 250);
          }
          return;
        }

        // ── FILL SAVED CREDENTIALS ──────────────────────────────────
        if (savedEmail && savedPassword) {
          // Use the native setter to ensure React picks up the value
          var nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          ).set;

          nativeSetter.call(emailInput, savedEmail);
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          emailInput.dispatchEvent(new Event('change', { bubbles: true }));

          nativeSetter.call(passwordInput, savedPassword);
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
          passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

          console.log('[Season Fresh Desktop] Saved credentials loaded.');
        }

        // ── CAPTURE ON SUBMIT ───────────────────────────────────────
        // Hook the form submit to save whatever the user actually submits
        var form = emailInput.closest('form');
        if (form && !form.__sfCredHooked) {
          form.__sfCredHooked = true;
          form.addEventListener('submit', function() {
            var email = emailInput.value;
            var password = passwordInput.value;
            if (email && password && window.desktopApp && window.desktopApp.saveCredentials) {
              window.desktopApp.saveCredentials(email, password);
            }
          }, true); // capture phase — runs before React's handler
        }
      }

      tryInject();
    })();
  `;

  mainWindow.webContents.executeJavaScript(script).catch((err) => {
    log.error('Credential injection failed:', err.message);
  });
}

// ── WINDOW CREATION ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'Season Fresh',
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

  // ── CLEAR SESSION ON LAUNCH ───────────────────────────────────────
  // Wipe browser cookies/localStorage so the server issues a fresh token.
  // NOTE: This does NOT affect the credential vault (stored in %APPDATA%
  // via safeStorage, completely outside the browser session).
  session.defaultSession.clearStorageData().then(() => {
    mainWindow.loadURL(PRODUCTION_URL);
  }).catch((err) => {
    log.error('Failed to clear session data:', err);
    mainWindow.loadURL(PRODUCTION_URL);
  });

  // ── DOWNLOAD HANDLING ─────────────────────────────────────────────
  session.defaultSession.on('will-download', (event, item, webContents) => {
    // Show download progress in the window title and taskbar
    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        if (!item.isPaused() && mainWindow) {
          const received = item.getReceivedBytes();
          const total = item.getTotalBytes();
          if (total > 0) {
            const percent = received / total;
            mainWindow.setProgressBar(percent);
            mainWindow.setTitle(`Season Fresh — Downloading ${item.getFilename()} (${Math.floor(percent * 100)}%)`);
          } else {
            mainWindow.setTitle(`Season Fresh — Downloading ${item.getFilename()}...`);
          }
        }
      }
    });

    item.once('done', (event, state) => {
      if (mainWindow) {
        mainWindow.setProgressBar(-1);
        mainWindow.setTitle('Season Fresh');
      }
      if (state === 'completed') {
        log.info(`Download completed: ${item.getSavePath()}`);
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Download Complete',
          message: `Successfully downloaded ${item.getFilename()}`,
          buttons: ['Open File', 'Show in Folder', 'OK'],
          defaultId: 0,
          cancelId: 2,
        }).then(({ response }) => {
          if (response === 0) {
            shell.openPath(item.getSavePath());
          } else if (response === 1) {
            shell.showItemInFolder(item.getSavePath());
          }
        });
      } else {
        log.error(`Download failed: ${state}`);
        dialog.showMessageBox(mainWindow, {
          title: 'Download Failed',
          type: 'error',
          message: `Failed to download ${item.getFilename()}.\nStatus: ${state}`
        });
      }
    });
  });

  // ── DETECT LOGIN PAGE & INJECT CREDENTIALS ────────────────────────
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    if (url.includes('/login')) {
      log.info('Login page detected — injecting credential helper.');
      injectCredentialHelper();
    }
  });

  // Also handle client-side navigation (e.g. session timeout redirect)
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    if (url.includes('/login')) {
      log.info('Navigated to login — injecting credential helper.');
      // Small delay to let the page render
      setTimeout(() => injectCredentialHelper(), 500);
    }
  });

  // ── NAVIGATION LOCK ───────────────────────────────────────────────
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedUrl(navigationUrl)) {
      event.preventDefault();
      log.warn(`Blocked navigation to: ${navigationUrl}`);
    }
  });

  // ── NEW WINDOW LOCK ───────────────────────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── ZOOM CONTROLS (Ctrl + / Ctrl - / Ctrl 0) ──────────────────────
  mainWindow.webContents.on('before-input-event', (event, input) => {
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
        `document.title = "Season Fresh — Downloading update v${info.version}..."`
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
        message: `Season Fresh v${info.version} is ready to install.`,
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
