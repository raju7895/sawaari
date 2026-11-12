/* Database backup helper: writes a plain-SQL dump to server/backups/.
   Usage: npm run db:backup              (timestamped dump)
   Uses pg_dump from the local PostgreSQL install; falls back to a
   logical export via pg when pg_dump is unavailable. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const dir = path.join(__dirname, '..', '..', 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(dir, `sawaari-${stamp}.sql`);

// Parse the connection string ourselves — never print the password.
const url = new URL(config.databaseUrl);
const host = url.hostname || 'localhost';
const port = url.port || '5432';
const user = decodeURIComponent(url.username || 'postgres');
const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'sawaari';
const password = decodeURIComponent(url.password || '');

function findBin(name) {
  if (process.env.PSQL_PATH) {
    const base = path.dirname(process.env.PSQL_PATH);
    const candidate = path.join(base, name + (process.platform === 'win32' ? '.exe' : ''));
    if (fs.existsSync(candidate)) return candidate;
  }
  const roots = [
    'C:\\Program Files\\PostgreSQL',
    '/usr/lib/postgresql',
    '/usr/local/pgsql',
    '/opt/homebrew/opt',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const rel of [`bin/${name}`, `bin/${name}.exe`]) {
        const p = path.join(root, entry, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

const env = { ...process.env, PGPASSWORD: password };
const pgDump = findBin('pg_dump');

async function logicalDump() {
  const { pool, query } = require('../db');
  const tables = (await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  )).rows.map((r) => r.table_name);
  const parts = [`-- Sawaari logical backup ${new Date().toISOString()}\n`];
  for (const t of tables) {
    const { rows } = await query(`SELECT * FROM "${t}"`);
    parts.push(`\n-- TABLE ${t} (${rows.length} rows)\n`);
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      parts.push(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')});\n`);
    }
  }
  fs.writeFileSync(out, parts.join(''));
  console.log(`✔ Logical backup written: ${out} (${tables.length} tables)`);
  await pool.end();
}

async function main() {
  if (pgDump) {
    try {
      const dump = execFileSync(
        pgDump,
        ['-h', host, '-p', port, '-U', user, '-d', database, '--no-password', '--clean', '--if-exists', '--format=plain'],
        { env, maxBuffer: 1024 * 1024 * 512, encoding: 'buffer' }
      );
      fs.writeFileSync(out, dump);
      console.log(`✔ Backup written: ${out} (${(dump.length / 1024).toFixed(0)} KB)`);
      return;
    } catch (err) {
      console.log(`pg_dump failed (${err.message.split('\n')[0]}) — falling back to logical export`);
    }
  }
  await logicalDump();
}

main().catch((e) => { console.error(e); process.exit(1); });
