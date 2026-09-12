import dotenv from 'dotenv';
dotenv.config();

const twilio = require('twilio');

async function testWhatsApp() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const targetNumber = 'whatsapp:+918320982232';
  const contentSid =
    process.env.TWILIO_WHATSAPP_EXAM_REMINDER_24H_CONTENT_SID ||
    process.env.TWILIO_WHATSAPP_RESULT_PUBLISHED_CONTENT_SID;

  console.log('--- Testing WhatsApp Integration ---');
  console.log('Account SID:', accountSid);
  console.log('From Number:', from);
  console.log('Target Recipient:', targetNumber);
  console.log('Configured Content SID:', contentSid || 'None (Free-form text mode)');

  let client;
  if (authToken && authToken.trim().length > 0) {
    console.log('Authentication Mode: Auth Token');
    client = twilio(accountSid, authToken.trim());
  } else if (apiKey && apiSecret) {
    console.log('Authentication Mode: API Key + Secret');
    client = twilio(apiKey.trim(), apiSecret.trim(), { accountSid });
  } else {
    console.error('❌ No Twilio credentials configured!');
    return;
  }

  // Strategy A: Send via Content Template SID if configured
  if (contentSid && contentSid.trim().length > 0) {
    console.log('\n--> Attempting to send using Twilio Approved Content Template SID...');
    try {
      const message = await client.messages.create({
        from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        to: targetNumber,
        contentSid: contentSid.trim(),
        contentVariables: JSON.stringify({
          '1': 'Aarav Sharma',
          '2': 'JEE Main Mock Test #1',
          '3': 'JEE Advanced 2026',
          '4': '15 Sep 2026',
          '5': '10:00 AM',
          '6': 'https://brainros.com',
        }),
      });

      console.log('✅ WhatsApp Template Message sent successfully!');
      console.log('Message SID:', message.sid);
      console.log('Status:', message.status);
      return;
    } catch (error: any) {
      console.error('❌ Template send failed:');
      console.error('Error Code:', error.code);
      console.error('Message:', error.message);
      console.error('Status:', error.status);
      console.error('More Info:', error.moreInfo);
      console.error('Full Error Object:', JSON.stringify(error, null, 2));
    }
  }

  // Strategy B: Send via Free-form message
  console.log('\n--> Attempting to send free-form WhatsApp message...');
  try {
    const message = await client.messages.create({
      from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
      to: targetNumber,
      body: 'Hello! This is a test WhatsApp notification from Brainros Platform to +918320982232. 🚀',
    });

    console.log('✅ WhatsApp Message sent successfully!');
    console.log('Message SID:', message.sid);
    console.log('Status:', message.status);
  } catch (error: any) {
    console.error('❌ Failed to send free-form WhatsApp message:');
    console.error('Error Code:', error.code);
    console.error('Message:', error.message);

    if (error.code === 21654) {
      console.log('\n💡 TWILIO DIAGNOSTIC (Error 21654: ContentSid Required):');
      console.log(
        'WhatsApp Business Policy requires approved Content Template SIDs (contentSid) when initiating outreach from a registered WhatsApp Business sender number to recipients outside the 24-hour customer window.',
      );
      console.log('\nTo resolve this:');
      console.log(
        '1. Set TWILIO_WHATSAPP_EXAM_REMINDER_24H_CONTENT_SID in backend/.env with your approved Twilio Content Template SID (e.g. HXxxxxxx).',
      );
      console.log(
        '2. OR for Twilio Sandbox testing, set TWILIO_WHATSAPP_FROM="whatsapp:+14155238886" and join the sandbox from +918320982232 by sending the sandbox keyword to +1 415 523 8886.',
      );
    }
  }
}

testWhatsApp();
