const { loadEnv } = require('./env-loader');
loadEnv();

const { testDatabase } = require('./test-database');
const { testRedis } = require('./test-redis');
const { testEmail } = require('./test-email');
const { testSms } = require('./test-sms');
const { testStorage } = require('./test-storage');

async function runAll() {
  console.log('\n================================================================');
  console.log('         BRAINROS THIRD-PARTY SERVICE DIAGNOSTICS               ');
  console.log(`         Environment: ${process.env.NODE_ENV || 'development'} | Time: ${new Date().toISOString()}`);
  console.log('================================================================\n');

  const results = [];

  // Run all diagnostic checks safely in sequence
  results.push(await testDatabase().catch((e) => ({ success: false, service: 'Database', error: e.message })));
  console.log('----------------------------------------------------------------');

  results.push(await testRedis().catch((e) => ({ success: false, service: 'Redis', error: e.message })));
  console.log('----------------------------------------------------------------');

  results.push(await testEmail().catch((e) => ({ success: false, service: 'Email (Resend)', error: e.message })));
  console.log('----------------------------------------------------------------');

  results.push(await testSms().catch((e) => ({ success: false, service: 'SMS / OTP', error: e.message })));
  console.log('----------------------------------------------------------------');

  results.push(await testStorage().catch((e) => ({ success: false, service: 'Storage', error: e.message })));
  console.log('----------------------------------------------------------------');

  // Summary Table
  console.log('\n================================================================');
  console.log('                     DIAGNOSTIC SUMMARY                         ');
  console.log('================================================================');

  let hasFatalFailure = false;

  for (const r of results) {
    const serviceCol = (r.service || 'Unknown').padEnd(26);
    if (r.success) {
      const extra = r.latencyMs ? `(${r.latencyMs}ms)` : (r.details || '');
      console.log(`  ${serviceCol} : ✅ OK ${extra}`);
    } else {
      console.log(`  ${serviceCol} : ❌ FAILED - ${r.error || 'Check logs'}`);
      if (r.service.includes('Database')) {
        hasFatalFailure = true;
      }
    }
  }

  console.log('================================================================\n');

  if (hasFatalFailure) {
    console.error('⚠️ Critical service(s) failed. Check details above.\n');
    process.exit(1);
  } else {
    console.log('🎉 Diagnostics finished. All critical dependencies verified.\n');
    process.exit(0);
  }
}

runAll();
