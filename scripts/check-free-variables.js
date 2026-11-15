/* Finds identifiers that are called but never declared or imported.
 *
 * An undefined identifier is not a build error in Vite — it is a runtime
 * crash ("x is not defined") that only shows up on the screen that happens
 * to use it. Two of those slipped through (a missing useCallback import and
 * a missing isAdminRole import), so they are checked here instead.
 *
 * A call is reported when the name is
 *   • used as a function call,
 *   • not a member expression (obj.method() is fine),
 *   • not declared in the file (import, const/let/var/function/class,
 *     function parameter, catch parameter),
 *   • not a browser/JavaScript global.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');

const GLOBALS = new Set([
  'console', 'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm', 'prompt',
  'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader', 'Headers',
  'Request', 'Response', 'AbortController', 'TextEncoder', 'TextDecoder', 'crypto',
  'structuredClone', 'queueMicrotask', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Symbol', 'BigInt', 'Infinity',
  'NaN', 'undefined', 'null', 'true', 'false', 'isNaN', 'isFinite', 'parseInt',
  'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'Intl', 'Reflect', 'Proxy', 'globalThis', 'performance', 'IntersectionObserver',
  'ResizeObserver', 'MutationObserver', 'Image', 'Audio', 'Event', 'CustomEvent',
  'HTMLElement', 'Node', 'Element', 'getComputedStyle', 'matchMedia', 'scrollTo',
  'supabase', 'import', 'require', 'process', 'Buffer', 'console', 'setTimeout',
]);

/* language keywords — they are not "undefined identifiers" */
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'throw',
  'try', 'catch', 'finally', 'new', 'typeof', 'instanceof', 'await', 'async', 'yield',
  'delete', 'void', 'in', 'of', 'this', 'super', 'constructor', 'function', 'class',
  'extends', 'export', 'from', 'as', 'static', 'get', 'set', 'break', 'continue',
  'switch', 'with', 'debugger', 'arguments', 'NaN', 'Infinity',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(name)) out.push(full);
  }
  return out;
}

/* blanks out comments and string/template literals so they are not scanned */
function stripLiterals(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function declaredNames(src) {
  const names = new Set();

  // imports
  const importRe = /import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const clause = m[1];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }
    const def = clause.replace(/\{[^}]*\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
    if (def && !def.startsWith('*')) names.add(def.replace(/,$/, '').trim());
    const star = clause.match(/\*\s+as\s+(\w+)/);
    if (star) names.add(star[1]);
  }

  // declarations
  const declRe = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src)) !== null) names.add(m[1]);

  // destructuring: const { a, b } = ... / const [a, b] = ...
  const destrRe = /\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g;
  while ((m = destrRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // function parameters: name(a, b) / (a, b) => / function (a, b)
  const paramRe = /(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*|\bfunction\s+[A-Za-z_$][\w$]*\s*)?\(([^()]*)\)\s*(?:=>|\{)/g;
  while ((m = paramRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // catch (e)
  const catchRe = /catch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = catchRe.exec(src)) !== null) names.add(m[1]);

  // object shorthand in JSX props: onClick={fn} is a value, not a call — ignore

  // class methods:  render() { ... }   static getDerivedStateFromError() { ... }
  // the parameter list must not contain braces, otherwise the greedy match
  // runs past the method it started on
  const methodRe = /^\s*(?:static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^(){}]*\)\s*\{/gm;
  while ((m = methodRe.exec(src)) !== null) names.add(m[1]);

  return names;
}

const files = walk(ROOT);
const problems = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const src = stripLiterals(raw);
  const declared = declaredNames(raw);
  const rel = relative(ROOT, file);

  // every "name(" that is not a member expression
  const callRe = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  const seen = new Set();
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);

    /* JSX text is not code: "Your name (for a new account)</label>" looks
       like a call, but the ")" is followed by a tag */
    const open = src.indexOf('(', m.index);
    let depth = 0;
    let close = -1;
    for (let k = open; k < src.length; k += 1) {
      if (src[k] === '(') depth += 1;
      else if (src[k] === ')') {
        depth -= 1;
        if (depth === 0) { close = k; break; }
      }
    }
    if (close >= 0 && /^\s*</.test(src.slice(close + 1, close + 12))) continue;

    if (declared.has(name)) continue;
    if (GLOBALS.has(name) || KEYWORDS.has(name)) continue;
    if (/^[A-Z]/.test(name)) continue; // JSX components are always imported
    problems.push({ file: rel, name });
  }
}

if (problems.length === 0) {
  console.log(`  OK - no undefined identifiers (${files.length} files)`);
  process.exit(0);
}

console.log('  UNDEFINED IDENTIFIERS:');
for (const p of problems) console.log(`    ${p.file} -> ${p.name}`);
process.exit(1);
