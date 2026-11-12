/* Migration runner: applies SQL files in order, tracks applied ones. */
const fs = require('fs');
const path = require('path');
const { pool, query } = require('./db');

async function main() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`✔ ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      console.log(`→ applying ${file} ...`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✔ ${file} applied`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const optional = fs.readFileSync(path.join(dir, file), 'utf8').includes('@optional');
      if (optional && /not available|does not exist|could not open/i.test(err.message)) {
        console.log(`⊘ ${file} skipped (optional, prerequisites missing: ${err.message.split('\n')[0]})`);
        continue;
      }
      console.error(`✖ ${file} failed: ${err.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  console.log('Migrations complete.');
  await pool.end();
}

main();
