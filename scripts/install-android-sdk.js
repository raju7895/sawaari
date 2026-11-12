/* Accepts the Android SDK licences and installs the packages needed to
 * build the APK. The `yes` pipe is unreliable through the .bat wrapper,
 * so the prompt is answered directly on stdin.
 *
 *   node scripts/install-android-sdk.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SDK = path.join(ROOT, '.toolchain', 'android-sdk');
const JAVA_HOME = path.join(ROOT, '.toolchain', 'jdk');
const SDKMANAGER = path.join(SDK, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');

const env = {
  ...process.env,
  JAVA_HOME,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  PATH: `${path.join(JAVA_HOME, 'bin')};${process.env.PATH}`,
};

function run(args, feedYes) {
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/c', SDKMANAGER, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const onData = (buf) => {
      out += buf.toString();
      if (feedYes) {
        // answer every prompt with "y"
        const prompts = (out.match(/\[y\/N\]/g) || []).length;
        const answered = (out.match(/accepted/gi) || []).length;
        for (let i = 0; i < Math.max(1, prompts - answered); i++) child.stdin.write('y\n');
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.stdin.on('error', () => {});
    if (feedYes) child.stdin.write('y\n');
    child.on('close', (code) => resolve({ code, out }));
  });
}

(async () => {
  if (!fs.existsSync(SDKMANAGER)) {
    console.error('sdkmanager not found — run scripts/setup-android-toolchain.js first');
    process.exit(1);
  }
  console.log('==> accepting licences');
  const lic = await run([`--sdk_root=${SDK}`, '--licenses'], true);
  console.log(lic.out.split('\n').filter((l) => /licen/i.test(l)).slice(-4).join('\n'));

  console.log('==> installing platform + build tools');
  const inst = await run([
    `--sdk_root=${SDK}`,
    'platform-tools',
    'platforms;android-34',
    'build-tools;34.0.0',
  ], true);
  console.log(inst.out.split('\n').slice(-8).join('\n'));

  console.log('\nToolchain summary');
  const check = (label, p) => console.log(`  ${fs.existsSync(p) ? '✔' : '✖'} ${label}`);
  check('java', path.join(JAVA_HOME, 'bin', 'java.exe'));
  check('adb', path.join(SDK, 'platform-tools', 'adb.exe'));
  check('android-34', path.join(SDK, 'platforms', 'android-34'));
  const btDir = path.join(SDK, 'build-tools');
  const bt = fs.existsSync(btDir) ? fs.readdirSync(btDir)[0] : null;
  check('build-tools', bt ? path.join(btDir, bt) : '(none)');
  check('apksigner', bt ? path.join(btDir, bt, 'apksigner.bat') : '(none)');
  check('zipalign', bt ? path.join(btDir, bt, 'zipalign.exe') : '(none)');
})();
