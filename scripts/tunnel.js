require('dotenv').config();
const ngrok = require('@ngrok/ngrok');

async function forwardToApp() {
  const port = process.env.PORT || 3000;
  const addr = process.env.NGROK_ADDR || `localhost:${port}`;
  const domain = process.env.NGROK_DOMAIN || 'footing-gallon-radial.ngrok-free.dev';
  const authtoken = process.env.NGROK_AUTHTOKEN;

  console.log(`[Ngrok] Starting tunnel forwarding to ${addr}...`);
  console.log(`[Ngrok] Target Domain: ${domain}`);

  try {
    const config = {
      addr: addr,
      domain: domain,
      authtoken_from_env: true,
      request_header_add: ['ngrok-skip-browser-warning:true'],
    };

    if (authtoken) {
      config.authtoken = authtoken;
    }

    const forwarder = await ngrok.forward(config);
    const publicUrl = forwarder.url();

    console.log(`\n================================================================`);
    console.log(`🚀 NGROK PUBLIC TUNNEL ESTABLISHED`);
    console.log(`   Public URL : ${publicUrl}`);
    console.log(`   Forwarding : ${addr}`);
    console.log(`================================================================\n`);

    const cleanup = async () => {
      console.log('\n[Ngrok] Closing tunnel...');
      try {
        await forwarder.close();
      } catch (_) {}
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    return forwarder;
  } catch (error) {
    console.error(`❌ [Ngrok] Failed to start tunnel: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  forwardToApp();
}

module.exports = { forwardToApp };
