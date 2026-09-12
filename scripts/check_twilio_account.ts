import dotenv from 'dotenv';
dotenv.config();

const twilio = require('twilio');

async function checkAccount() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  let client;
  if (authToken && authToken.trim().length > 0) {
    client = twilio(accountSid, authToken.trim());
  } else if (apiKey && apiSecret) {
    client = twilio(apiKey.trim(), apiSecret.trim(), { accountSid });
  }

  console.log('--- Twilio Account Diagnostics ---');
  try {
    const account = await client.api.v2010.accounts(accountSid).fetch();
    console.log('Account Name:', account.friendlyName);
    console.log('Account Status:', account.status);
    console.log('Account Type:', account.type); // Trial or Full

    console.log('\n--- Incoming Phone Numbers ---');
    const numbers = await client.incomingPhoneNumbers.list({ limit: 10 });
    if (numbers.length === 0) {
      console.log('No incoming phone numbers purchased.');
    } else {
      numbers.forEach((n: any) => console.log(`- ${n.phoneNumber} (${n.friendlyName})`));
    }

    console.log('\n--- Verified Caller IDs ---');
    const validationRequests = await client.outgoingCallerIds.list({ limit: 10 });
    if (validationRequests.length === 0) {
      console.log('No verified caller IDs found.');
    } else {
      validationRequests.forEach((v: any) =>
        console.log(`- ${v.phoneNumber} (${v.friendlyName})`),
      );
    }
  } catch (err: any) {
    console.error('Error fetching Twilio account details:', err.message);
  }
}

checkAccount();
