/* Installs the Android build toolchain (JDK 17 + Android SDK) into
 * .toolchain\ so an APK can be produced without touching the system.
 *
 * Written in Node because the Windows console mangles the stderr of the
 * native downloader/extractor tools.
 *
 *   node scripts/setup-android-toolchain.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TC = path.join(ROOT, '.toolchain');
const SDK = path.join(TC, 'android-sdk');
const CMDLINE = path.join(SDK, 'cmdline-tools', 'latest');
const JDK = path.join(TC, 'jdk');

const step = (m) => console.log(`==> ${m}`);
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;

/* ── download with resume ─────────────────────────────────────── */
function download(url, dest, expectedMinBytes) {
  if (fs.existsSync(dest) && fs.statSync(dest).size >= expectedMinBytes) {
    console.log(`   already downloaded (${mb(fs.statSync(dest).size)})`);
    return true;
  }
  for (let attempt = 1; attempt <= 15; attempt++) {
    const args = ['-sS', '-L', '--fail', '--connect-timeout', '30', '--max-time', '420',
      '--speed-limit', '2000', '--speed-time', '45', '-C', '-', '-o', dest, url];
    const r = spawnSync('curl.exe', args, { stdio: 'ignore' });
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    console.log(`   attempt ${attempt} → ${mb(size)}`);
    if (size >= expectedMinBytes) return true;
  }
  return false;
}

/* ── extract a zip with the built-in tar ──────────────────────── */
function extract(zip, into) {
  fs.mkdirSync(into, { recursive: true });
  const r = spawnSync('tar.exe', ['-xf', zip, '-C', into], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`tar failed for ${zip}`);
}

function main() {
  fs.mkdirSync(TC, { recursive: true });

  /* ── 1. JDK 17 ─────────────────────────────────────────────── */
  const javaExe = path.join(JDK, 'bin', 'java.exe');
  if (!fs.existsSync(javaExe)) {
    step('Downloading Temurin JDK 17…');
    const zip = path.join(TC, 'jdk.zip');
    if (!download('https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse', zip, 150 * 1024 * 1024)) {
      throw new Error('JDK download failed');
    }
    step('Extracting JDK…');
    extract(zip, JDK);
    fs.rmSync(zip, { force: true });
    // the archive holds a single versioned folder — flatten it
    const inner = fs.readdirSync(JDK).find((f) => fs.statSync(path.join(JDK, f)).isDirectory());
    if (inner) {
      const src = path.join(JDK, inner);
      for (const f of fs.readdirSync(src)) {
        fs.renameSync(path.join(src, f), path.join(JDK, f));
      }
      fs.rmSync(src, { recursive: true, force: true });
    }
  }
  if (!fs.existsSync(javaExe)) throw new Error('JDK extraction failed');
  const env = { ...process.env, JAVA_HOME: JDK, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK };
  const v = spawnSync(javaExe, ['-version'], { env, encoding: 'utf8' });
  step(`JDK ready: ${(v.stderr || v.stdout || '').split('\n')[0].trim()}`);

  /* ── 2. Android command-line tools ─────────────────────────── */
  const sdkmanager = path.join(CMDLINE, 'bin', 'sdkmanager.bat');
  if (!fs.existsSync(sdkmanager)) {
    step('Downloading Android command-line tools…');
    const zip = path.join(TC, 'cmdtools.zip');
    if (!download('https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip', zip, 140 * 1024 * 1024)) {
      throw new Error('command-line tools download failed');
    }
    step('Extracting…');
    const tmp = path.join(SDK, 'cmdline-tools');
    fs.mkdirSync(tmp, { recursive: true });
    extract(zip, tmp);
    fs.rmSync(zip, { force: true });
    const nested = path.join(tmp, 'cmdline-tools');
    if (fs.existsSync(nested)) {
      fs.rmSync(CMDLINE, { recursive: true, force: true });
      fs.renameSync(nested, CMDLINE);
    }
  }
  if (!fs.existsSync(sdkmanager)) throw new Error(`sdkmanager not found at ${sdkmanager}`);
  step('sdkmanager ready');

  /* ── 3. licences ───────────────────────────────────────────── */
  step('Accepting SDK licences…');
  spawnSync('cmd.exe', ['/c', 'echo y|'.repeat(40), sdkmanager, `--sdk_root=${SDK}`, '--licenses'],
    { env, stdio: 'ignore' });

  /* ── 4. platform + build tools ──────────────────────────────── */
  step('Installing platforms;android-34, build-tools;34.0.0, platform-tools…');
  const install = spawnSync('cmd.exe', ['/c', sdkmanager, `--sdk_root=${SDK}`,
    'platform-tools', 'platforms;android-34', 'build-tools;34.0.0'], { env, encoding: 'utf8' });
  const tail = ((install.stdout || '') + (install.stderr || '')).trim().split('\n').slice(-6);
  tail.forEach((l) => console.log(`   ${l}`));

  /* ── 5. verify ──────────────────────────────────────────────── */
  const bt = fs.existsSync(path.join(SDK, 'build-tools'))
    ? fs.readdirSync(path.join(SDK, 'build-tools'))[0] : null;
  const check = (label, p) => console.log(`  ${fs.existsSync(p) ? '✔' : '✖'} ${label}`);
  console.log('');
  console.log('Toolchain summary');
  check('java', javaExe);
  check('sdkmanager', sdkmanager);
  check('adb', path.join(SDK, 'platform-tools', 'adb.exe'));
  check('android-34 platform', path.join(SDK, 'platforms', 'android-34'));
  check('build-tools', bt ? path.join(SDK, 'build-tools', bt) : '');
  check('apksigner', bt ? path.join(SDK, 'build-tools', bt, 'apksigner.bat') : '');
  check('zipalign', bt ? path.join(SDK, 'build-tools', bt, 'zipalign.exe') : '');
  console.log('');
  console.log(`JAVA_HOME=${JDK}`);
  console.log(`ANDROID_HOME=${SDK}`);
}

main();
