const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

/** Run a parameterized query */
const query = (text, params = []) => pool.query(text, params);

/** Run a callback inside a transaction; rolls back on throw */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Get one row or null */
async function one(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

/** Get rows */
async function many(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows;
}

module.exports = { pool, query, withTransaction, one, many };
