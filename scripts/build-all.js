/* Builds every deliverable in one go:
 *
 *   1. production web build (with the API base baked in)
 *   2. Android: sync the web build into the project and assemble a
 *      signed release APK
 *   3. Windows: package the Electron app and build the NSIS installer
 *      + portable executable
 *
 *   node scripts/build-all.js [--skip-android] [--skip-windows]
 *
 * The Android and Windows toolchains must already be set up:
 *   node scripts/setup-android-toolchain.js
 *   node scripts/install-android-sdk.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const ANDROID = path.join(WEB, 'android');
const ELECTRON = path.join(ROOT, 'electron');
const TC = path.join(ROOT, '.toolchain');
const SDK = path.join(TC, 'android-sdk');
const JAVA = path.join(TC, 'jdk');
const OUT_APK = path.join(ROOT, 'dist-android');
const OUT_WIN = path.join(ROOT, 'dist-windows');

const args = process.argv.slice(2);
const skipAndroid = args.includes('--skip-android');
const skipWindows = args.includes('--skip-windows');
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://vwpxxgmcjrzegnqrpvsv.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DWc8VP6s8ToTLa5f_AxoHg_rtJvN8A6';

const step = (m) => console.log(`\n▶ ${m}`);
const ok = (m) => console.log(`  ✔ ${m}`);

function run(cmd, cmdArgs, opts = {}) {
  /* Node refuses to spawn .cmd / .bat files without a shell (CVE-2024-27980
     hardening), so Windows helpers are started through the shell and every
     argument that contains a space is quoted. */
  const isWinScript = /\.(cmd|bat)$/i.test(cmd);
  const quote = (a) => (/[\s&|<>^"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: opts.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: isWinScript,
  });
  if (r.error) throw new Error(`${cmd} ${cmdArgs.join(' ')} could not start: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    if (opts.quiet) console.log((r.stdout || '') + (r.stderr || ''));
    throw new Error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
  }
  return r;
}

function main() {
  /* ── 1. web build ─────────────────────────────────────────── */
  step('Building the web app');
  fs.mkdirSync(path.join(WEB, 'dist'), { recursive: true });
  run('npm.cmd', ['run', 'build'], {
    cwd: WEB,
    env: { VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_ANON_KEY: anonKey },
  });
  ok(`web build → web/dist (Supabase: ${supabaseUrl})`);

  /* ── 2. Android ───────────────────────────────────────────── */
  if (!skipAndroid) {
    step('Building the Android APK');
    run('npx.cmd', ['cap', 'sync', 'android'], { cwd: WEB });
    ok('web assets synced into the Android project');

    if (!fs.existsSync(path.join(ANDROID, 'keystore.properties'))) {
      run('node', [path.join(WEB, 'scripts', 'setup-android-signing.cjs')]);
    }
    ok('release keystore ready');

    const gradleEnv = {
      JAVA_HOME: JAVA,
      ANDROID_HOME: SDK,
      ANDROID_SDK_ROOT: SDK,
      PATH: `${path.join(JAVA, 'bin')};${path.join(SDK, 'platform-tools')};${process.env.PATH}`,
    };
    run('gradlew.bat', ['assembleRelease', '--no-daemon'], { cwd: ANDROID, env: gradleEnv });

    const apk = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!fs.existsSync(apk)) throw new Error('APK was not produced');
    fs.mkdirSync(OUT_APK, { recursive: true });
    const target = path.join(OUT_APK, 'LocalAutoBooking.apk');
    fs.copyFileSync(apk, target);
    ok(`APK → ${path.relative(ROOT, target)} (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  /* ── 3. Windows ───────────────────────────────────────────── */
  if (!skipWindows) {
    step('Building the Windows desktop app');
    if (!fs.existsSync(path.join(ELECTRON, 'node_modules', 'electron'))) {
      run('npm.cmd', ['install'], { cwd: ELECTRON });
    }
    run('node', [path.join(ELECTRON, 'build-icon.cjs')]);

    /* A running copy of the unpacked build locks its files, and
       electron-builder then fails with "Access is denied". */
    const unpacked = path.join(ELECTRON, 'dist', 'win-unpacked');
    if (fs.existsSync(unpacked)) {
      try {
        fs.rmSync(unpacked, { recursive: true, force: true });
        ok('removed the previous win-unpacked folder');
      } catch {
        console.log('  ! win-unpacked is locked — close any running Sawaari window and retry');
        throw new Error('electron\\dist\\win-unpacked is locked by a running Sawaari.exe');
      }
    }

    const env = { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
    run('npx.cmd', ['electron-builder', '--win', '--x64', '--dir'], { cwd: ELECTRON, env });
    ok('Electron app packaged');

    const makensis = path.join(
      process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis',
      'nsis-3.0.4.1', 'Bin', 'makensis.exe'
    );
    if (!fs.existsSync(makensis)) {
      console.log('  ! makensis not found — skipping the NSIS installers');
    } else {
      fs.mkdirSync(OUT_WIN, { recursive: true });
      /* makensis.exe is a plain executable — run it directly, no shell quoting */
      run(makensis, ['/V3', 'installer.nsi'], { cwd: ELECTRON });
      run(makensis, ['/V3', 'portable.nsi'], { cwd: ELECTRON });
      for (const f of fs.readdirSync(OUT_WIN)) {
        ok(`${f} (${(fs.statSync(path.join(OUT_WIN, f)).size / 1024 / 1024).toFixed(1)} MB)`);
      }
    }
  }

  console.log('\n──────────────────────────────────────────────');
  console.log('  Build complete');
  console.log('──────────────────────────────────────────────');
}

try {
  main();
} catch (err) {
  console.error(`\n✖ build failed: ${err.message}`);
  process.exit(1);
}
