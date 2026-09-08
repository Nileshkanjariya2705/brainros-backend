const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function main() {
  const examId = '0374f9e0-f8d7-4f6f-b557-9ae98099795e';
  const gujaratiLangId = '57bdaa71-e2b3-48c6-bc0d-a26c4def36ee';

  // Login as admin/super admin to get token
  const loginRes = await axios.post('http://127.0.0.1:3000/auth/login', {
    email: 'superadmin@brainros.com',
    password: 'Password@123'
  }).catch(async () => {
    // Try admin login if superadmin credentials differ
    return axios.post('http://127.0.0.1:3000/auth/login', {
      email: 'admin@brainros.com',
      password: 'Password@123'
    });
  });

  const token = loginRes.data?.data?.accessToken || loginRes.data?.accessToken;
  console.log('Got Auth Token successfully!');

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

  console.log('Validation API Response Status:', validateRes.status);
  console.log('Validation Response Summary:', {
    totalRows: validateRes.data?.data?.totalRows,
    validRows: validateRes.data?.data?.validRows,
    invalidRows: validateRes.data?.data?.invalidRows,
    coverageAfterImportPercentage: validateRes.data?.data?.coverageAfterImportPercentage
  });
}

main().catch(err => {
  console.error('Test error:', err?.response?.data || err?.message);
});
