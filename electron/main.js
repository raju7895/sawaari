/* Electron shell for the Sawaari desktop app.
 *
 * The renderer is the production web build (web/dist) served from a local
 * HTTP server on a FIXED port, so the origin — and therefore the stored
 * session — survives restarts. The API is reached through the same
 * runtime-configurable base URL the web app uses (see web/src/serverConfig.js).
 *
 * Security: node integration is off, context isolation is on, the window
 * cannot navigate to arbitrary origins and external links open in the
 * user's browser instead.
 */
const { app, BrowserWindow, shell, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5188;                 // fixed so localStorage/sessions persist
const HOST = '127.0.0.1';
const DIST = path.join(__dirname, '..', 'web', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
      // prevent path traversal outside the build folder
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST, 'index.html');   // SPA fallback
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
        'Service-Worker-Allowed': '/',
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, HOST, () => resolve(server));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 360,
    minHeight: 560,
    show: false,
    backgroundColor: '#0f172a',
    title: 'Sawaari — Auto Booking',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://${HOST}:${PORT}/`);

  // External links (support, maps) open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://${HOST}:${PORT}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

app.whenReady().then(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    // eslint-disable-next-line no-console
    console.error('[desktop] web/dist is missing — run "npm run build" in the web folder first.');
  }
  await serve();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
