const { loadEnv } = require('./env-loader');
loadEnv();

async function testEmail() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DIAGNOSTIC] Testing Email Service (Resend)...`);

  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  if (!apiKey) {
    console.error(`❌ [FAILED] EMAIL_API_KEY is not configured.`);
    return { success: false, service: 'Email (Resend)', error: 'Missing EMAIL_API_KEY' };
  }

  const maskedKey = apiKey.substring(0, 7) + '...' + apiKey.slice(-4);
  console.log(`  API Key: ${maskedKey} | From: ${from}`);

  const start = Date.now();
  try {
    // Check API Key validity against Resend /api-keys endpoint (safe, non-destructive, does NOT send email)
    const response = await fetch('https://api.resend.com/api-keys', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    const elapsed = Date.now() - start;
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      console.log(`✅ [OK] Resend API authenticated in ${elapsed}ms | Status: 200 OK (No emails sent)`);
      return { success: true, service: 'Email (Resend)', latencyMs: elapsed };
    } else {
      const errorMsg = data?.message || data?.error || `HTTP ${response.status}`;
      console.error(`❌ [FAILED] Resend API rejected credentials (${elapsed}ms): ${errorMsg}`);
      return { success: false, service: 'Email (Resend)', error: errorMsg };
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`❌ [FAILED] Resend API unreachable (${elapsed}ms): ${err.message}`);
    return { success: false, service: 'Email (Resend)', error: err.message };
  }
}

if (require.main === module) {
  testEmail().then((res) => process.exit(res.success ? 0 : 1));
}

module.exports = { testEmail };
