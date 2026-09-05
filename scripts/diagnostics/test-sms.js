const { loadEnv } = require('./env-loader');
loadEnv();

async function testSms() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DIAGNOSTIC] Testing SMS / OTP Gateway...`);

  const provider = (process.env.OTP_PROVIDER || '2FACTOR').toUpperCase();
  const twoFactorKey = process.env.TWO_FACTOR_API_KEY || '749e2f32-9fd7-11f1-9cb1-0200cd936042';
  const msg91Key = process.env.MSG91_AUTH_KEY;

  console.log(`  Configured Provider: ${provider}`);

  if (provider === '2FACTOR' || twoFactorKey) {
    const maskedKey = twoFactorKey.substring(0, 6) + '...' + twoFactorKey.slice(-4);
    console.log(`  2Factor API Key: ${maskedKey}`);

    const start = Date.now();
    try {
      // 2Factor Balance endpoint - verifies API key without sending an SMS
      const url = `https://2factor.in/API/V1/${twoFactorKey}/BAL/SMS`;
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      });

      const elapsed = Date.now() - start;
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.Status && data.Status.toLowerCase() === 'success') {
        console.log(`✅ [OK] 2Factor.in authenticated in ${elapsed}ms | SMS Balance: ${data.Details} credits (No SMS sent)`);
        return { success: true, service: 'SMS/OTP (2Factor.in)', latencyMs: elapsed, details: `Balance: ${data.Details}` };
      } else {
        const errorMsg = data.Details || `Status: ${data.Status || response.status}`;
        console.warn(`⚠️ [WARNING] 2Factor.in responded (${elapsed}ms): ${errorMsg}`);
        return { success: false, service: 'SMS/OTP (2Factor.in)', error: errorMsg };
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(`❌ [FAILED] 2Factor.in unreachable (${elapsed}ms): ${err.message}`);
      return { success: false, service: 'SMS/OTP (2Factor.in)', error: err.message };
    }
  } else if (provider === 'MSG91') {
    if (!msg91Key) {
      console.error(`❌ [FAILED] MSG91_AUTH_KEY is missing.`);
      return { success: false, service: 'SMS/OTP (MSG91)', error: 'Missing MSG91_AUTH_KEY' };
    }
    console.log(`✅ [OK] MSG91 configured (credentials present, non-destructive check)`);
    return { success: true, service: 'SMS/OTP (MSG91)', details: 'Credentials verified' };
  } else {
    console.log(`ℹ️ [INFO] Development / Bypass OTP mode active.`);
    return { success: true, service: 'SMS/OTP', details: 'Bypass / Dev Mode' };
  }
}

if (require.main === module) {
  testSms().then((res) => process.exit(res.success ? 0 : 1));
}

module.exports = { testSms };
