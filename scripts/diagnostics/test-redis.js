const { loadEnv } = require('./env-loader');
loadEnv();
const Redis = require('ioredis');

async function testRedis() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DIAGNOSTIC] Testing Redis Connection...`);

  const redisUrl = process.env.REDIS_URL;
  let client;

  if (redisUrl) {
    const maskedUrl = redisUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`  Target (REDIS_URL): ${maskedUrl}`);
    client = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 8000,
      maxRetriesPerRequest: 1,
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    });
  } else {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    console.log(`  Target: ${host}:${port} (password: ${password ? 'SET' : 'NONE'})`);
    client = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      connectTimeout: 8000,
      maxRetriesPerRequest: 1,
    });
  }

  // Attach error handler immediately to avoid unhandled rejections
  client.on('error', (err) => {
    // caught by connection flow
  });

  const start = Date.now();
  try {
    await client.connect();
    const pingRes = await client.ping();
    const testKey = `diagnostic:ping:${Date.now()}`;
    await client.set(testKey, 'ok', 'EX', 10);
    const val = await client.get(testKey);
    await client.del(testKey);
    const elapsed = Date.now() - start;

    await client.quit();
    console.log(`✅ [OK] Redis connected in ${elapsed}ms | PING: ${pingRes} | Read/Write Verified`);
    return { success: true, service: 'Redis (Cache & Queues)', latencyMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`❌ [FAILED] Redis connection failed (${elapsed}ms): ${err.message}`);
    try { client.disconnect(); } catch (_) {}
    return { success: false, service: 'Redis (Cache & Queues)', error: err.message };
  }
}

if (require.main === module) {
  testRedis().then((res) => process.exit(res.success ? 0 : 1));
}

module.exports = { testRedis };
