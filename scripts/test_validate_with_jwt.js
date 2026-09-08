const jwt = require('jsonwebtoken');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function main() {
  const examId = '0374f9e0-f8d7-4f6f-b557-9ae98099795e';
  const gujaratiLangId = '57bdaa71-e2b3-48c6-bc0d-a26c4def36ee';

  const jwtSecret = 'super-secret-jwt-key-replace-in-production';
  const payload = {
    userId: '0f577461-6f9b-41fe-a796-6587e2571959',
    email: 'admin@brainros.com',
    role: 'SUPER_ADMIN',
    type: 'access'
  };

  const token = jwt.sign(payload, jwtSecret, { expiresIn: '1h' });

  const form = new FormData();
  form.append('languageId', gujaratiLangId);
  form.append('file', fs.createReadStream('d:/exam mangment/brainros_jee_main_test_01_gujarati_translations.csv'));

  const validateRes = await axios.post(
    `http://127.0.0.1:3000/exams/${examId}/translations/validate`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`
      }
    }
  );

  console.log('Validation API Status:', validateRes.status);
  console.log('Validation Response Data:', JSON.stringify(validateRes.data, null, 2));
}

main().catch(err => {
  console.error('Test error:', err?.response?.data || err?.message);
});
