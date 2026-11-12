/* Generates the Android launcher icons (legacy + adaptive) from the
 * Sawaari mark, and the splash screen drawable.
 *
 *   node scripts/generate-android-icons.js
 */
const fs = require('fs');
const path = require('path');
const { drawIcon } = require('./lib/icon-draw.cjs');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

/* launcher icon densities */
const LAUNCHER = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

/* adaptive icon foregrounds live on a 108dp canvas */
const ADAPTIVE = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
];

let count = 0;

for (const [dir, size] of LAUNCHER) {
  const out = path.join(RES, dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'ic_launcher.png'), drawIcon(size, {}));
  fs.writeFileSync(path.join(out, 'ic_launcher_round.png'), drawIcon(size, { maskable: true }));
  fs.writeFileSync(path.join(out, 'ic_launcher_foreground.png'), drawIcon(size, { adaptive: true }));
  count += 3;
  console.log(`  ✔ ${dir.padEnd(20)} ${size}×${size}`);
}

/* Play Store / splash artwork */
const drawable = path.join(RES, 'drawable');
fs.mkdirSync(drawable, { recursive: true });
fs.writeFileSync(path.join(drawable, 'splash_logo.png'), drawIcon(384, {}));
count += 1;
console.log('  ✔ drawable/splash_logo.png');

/* adaptive icon XML — the background is a brand colour (Capacitor already
   ships a drawable/ic_launcher_background, so a second one would clash) */
const anydpi = path.join(RES, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpi, { recursive: true });
fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/sawaari_brand" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`);
fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/sawaari_brand" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`);
count += 2;

/* the brand colour used as the adaptive background */
const values = path.join(RES, 'values');
fs.mkdirSync(values, { recursive: true });
fs.writeFileSync(path.join(values, 'sawaari_brand.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="sawaari_brand">#0D9488</color>
</resources>
`);
count += 1;

/* remove a stale PNG with the same name as Capacitor's own resource */
const clash = path.join(RES, 'drawable', 'ic_launcher_background.png');
if (fs.existsSync(clash)) {
  fs.rmSync(clash);
  console.log('  ✔ removed duplicate drawable/ic_launcher_background.png');
}

/* ── splash screens (replace Capacitor's default artwork) ───────
   portrait / landscape artwork per density, dark background with the
   Sawaari mark centred. */
const { drawSplash } = require('./lib/icon-draw.cjs');
const SPLASH = [
  ['mdpi', 320, 480, 320, 480],
  ['hdpi', 480, 800, 480, 800],
  ['xhdpi', 720, 1280, 720, 1280],
  ['xxhdpi', 960, 1600, 960, 1600],
  ['xxxhdpi', 1280, 1920, 1280, 1920],
];
for (const [density, pw, ph, lw, lh] of SPLASH) {
  const logo = Math.round(Math.min(pw, ph) * 0.34);
  const portrait = drawSplash(pw, ph, logo);
  const landscape = drawSplash(lw, lh, logo);
  const pdir = path.join(RES, `drawable-port-${density}`);
  const ldir = path.join(RES, `drawable-land-${density}`);
  fs.mkdirSync(pdir, { recursive: true });
  fs.mkdirSync(ldir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'splash.png'), portrait);
  fs.writeFileSync(path.join(ldir, 'splash.png'), landscape);
  count += 2;
  console.log(`  ✔ splash ${density.padEnd(8)} ${pw}×${ph} / ${lw}×${lh}`);
}

console.log(`\n  ${count} Android resources written to ${RES}`);
