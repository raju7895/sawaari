/* Finds React hooks that are used but never imported from "react".
 * A missing import is a runtime crash ("useCallback is not defined"),
 * not a lint warning - so it is worth checking on every build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const REACT_HOOKS = [
  'useState', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback',
  'useRef', 'useContext', 'useReducer', 'useId', 'useSyncExternalStore',
  'useInsertionEffect', 'useImperativeHandle', 'useDebugValue',
];
const ROUTER_HOOKS = [
  'useNavigate', 'useLocation', 'useParams', 'useSearchParams',
  'useMatch', 'useRoutes', 'useHref', 'useInRouterContext', 'useOutlet',
  'useOutletContext', 'useBlocker', 'useAsyncValue', 'useAsyncError',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const problems = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);

  const namesFrom = (pkg) => {
    const m = src.match(new RegExp("import\\s*\\{([^}]*)\\}\\s*from\\s*['\"]" + pkg + "['\"]"));
    return m ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
  };

  const reactImported = namesFrom('react');
  const routerImported = namesFrom('react-router-dom');

  // hooks used in the file body (import lines are ignored)
  const body = src.replace(/import\s+[^;]+;/g, '');
  const usedIn = (hooks) => {
    const found = new Set();
    for (const hook of hooks) {
      const re = new RegExp('(?<![\\w.$])' + hook + '\\s*\\(', 'g');
      if (re.test(body)) found.add(hook);
    }
    return found;
  };

  const missing = [
    ...[...usedIn(REACT_HOOKS)].filter((h) => !reactImported.includes(h)),
    ...[...usedIn(ROUTER_HOOKS)].filter((h) => !routerImported.includes(h)),
  ];

  if (missing.length) problems.push({ file: rel, missing });
}

if (problems.length === 0) {
  console.log('  OK - every React hook that is used is imported (' + files.length + ' files)');
  process.exit(0);
}

console.log('  MISSING HOOK IMPORTS:');
for (const p of problems) console.log('    ' + p.file + ' -> ' + p.missing.join(', '));
process.exit(1);
