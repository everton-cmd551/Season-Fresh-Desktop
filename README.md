# Season Fresh ERP — Desktop Client

A lightweight Electron desktop shell for **Season Fresh ERP**. This app loads the live [production URL](https://season-fresh.vercel.app) and provides automatic updates via GitHub Releases.

> **⚠️ This is a Thin Client.** It contains zero ERP business logic, zero API keys, and zero database credentials. All application logic runs securely on Vercel.

---

## Quick Start

```bash
# Install dependencies
npm install

# Launch in development mode
npm run dev

# Launch in production mode
npm start
```

## Building & Releasing

### Local Build (produces installer in `dist/`)
```bash
npm run pack
```

### Publish to GitHub Releases
Requires `GH_TOKEN` environment variable with a GitHub Personal Access Token (`repo` scope):

```powershell
$env:GH_TOKEN="ghp_your_token_here"
npm run release
```

Or use the automated CI/CD pipeline:
1. Tag your commit: `git tag v1.0.1`
2. Push the tag: `git push origin v1.0.1`
3. GitHub Actions will build and publish the release automatically.

---

## Auto-Update

The app checks for updates on launch and every 4 hours. When a new version is available:
1. The update downloads silently in the background.
2. A dialog prompts the user to restart.
3. The update installs on restart.

Update metadata (`latest.yml`) and binaries (`.exe`) are hosted on [GitHub Releases](https://github.com/everton-cmd551/Season-Fresh-Desktop/releases).

---

## Security Model

| Layer | Protection |
|-------|-----------|
| `nodeIntegration` | `false` — remote content cannot access Node.js |
| `contextIsolation` | `true` — renderer scripts are sandboxed |
| `sandbox` | `true` — OS-level process sandboxing |
| Navigation Lock | Only `season-fresh.vercel.app` domains permitted |
| New Window Lock | External URLs open in the system browser |
| CSP Headers | Injected via `onHeadersReceived` |

---

## Project Structure

```
Season-Fresh-Desktop/
├── main.js              # Electron main process
├── preload.js           # Minimal contextBridge
├── offline.html         # Offline fallback UI
├── package.json         # Dependencies & electron-builder config
├── icons/               # App icons (ico, icns, png)
├── .github/
│   └── workflows/
│       └── release.yml  # CI/CD pipeline
└── dist/                # Build output (gitignored)
```
