const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  database: process.env.DB_NAME || 'shiv_erp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000
});

async function query(text, params = []) {
  const startedAt = Date.now();
  try {
    const result = await pool.query(text, params);
    console.log(`[db] ${Date.now() - startedAt}ms ${text.split(/\s+/).slice(0, 4).join(' ')}`);
    return result;
  } catch (error) {
    console.error('[db:error]', error.message);
    throw error;
  }
}

module.exports = { query, pool };
