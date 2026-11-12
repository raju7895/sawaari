/* Serves the installation files over the local network so the phone can
 * download the APK directly from the PC.
 *
 *   node scripts/serve-downloads.js            # port 8000
 *   node scripts/serve-downloads.js --port 9000
 *
 * It only ever serves files from the "Local Auto Booking App" folder and
 * refuses path traversal. Stop it with Ctrl+C.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), 'Downloads', 'Local Auto Booking App');
const argPort = process.argv.indexOf('--port');
const PORT = argPort > -1 ? parseInt(process.argv[argPort + 1], 10) : 8000;

if (!fs.existsSync(ROOT)) {
  console.error(`Folder not found: ${ROOT}`);
  process.exit(1);
}

const MIME = {
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.zip': 'application/zip',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? '' : urlPath.replace(/^\/+/, '');
  const base = path.resolve(ROOT);
  const file = rel ? path.resolve(base, rel) : base;

  // never serve anything outside the delivery folder
  if (file !== base && !file.startsWith(base + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!rel || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const files = fs.readdirSync(ROOT).map((f) => {
      const st = fs.statSync(path.join(ROOT, f));
      const size = st.isDirectory() ? '-' : `${(st.size / 1024 / 1024).toFixed(1)} MB`;
      return `<tr><td><a href="/${encodeURIComponent(f)}">${f}</a></td><td>${size}</td></tr>`;
    }).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8">
<title>Sawaari downloads</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px}
h1{color:#0d9488}table{border-collapse:collapse;margin-top:20px;width:100%;max-width:640px}
td{padding:10px;border-bottom:1px solid #334155}a{color:#5eead4}</style>
<h1>Sawaari — installation files</h1>
<p>Open a link to download, then install.</p>
<table>${files}</table>`);
  }

  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) addresses.push(i.address);
    }
  }
  console.log(`\n  Sawaari downloads are live on port ${PORT}`);
  addresses.forEach((a) => console.log(`    http://${a}:${PORT}/`));
  console.log(`\n  Files in: ${ROOT}`);
  console.log('  Press Ctrl+C to stop.\n');
});
