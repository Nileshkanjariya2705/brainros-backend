const { loadEnv } = require('./env-loader');
loadEnv();
const { Pool } = require('pg');

async function testDatabase() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DIAGNOSTIC] Testing Database Connection...`);

  const dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!dbUrl) {
    console.error(`❌ [FAILED] DATABASE_URL is not set in environment.`);
    return { success: false, service: 'Database (PostgreSQL)', error: 'Missing DATABASE_URL' };
  }

  // Mask credentials for display
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`  Target: ${maskedUrl}`);

  const pool = new Pool({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
    max: 1,
  });

  const start = Date.now();
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1 AS alive, NOW() AS server_time, current_database() AS db_name');
    const elapsed = Date.now() - start;
    client.release();
    await pool.end();

    const row = result.rows[0];
    console.log(`✅ [OK] Database connected in ${elapsed}ms | DB: ${row.db_name} | Server Time: ${row.server_time}`);
    return { success: true, service: 'Database (PostgreSQL)', latencyMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`❌ [FAILED] Database connection failed (${elapsed}ms): ${err.message}`);
    try { await pool.end(); } catch (_) {}
    return { success: false, service: 'Database (PostgreSQL)', error: err.message };
  }
}

if (require.main === module) {
  testDatabase().then((res) => process.exit(res.success ? 0 : 1));
}

module.exports = { testDatabase };
