const { loadEnv } = require('./env-loader');
loadEnv();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

async function testStorage() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DIAGNOSTIC] Testing Storage Service...`);

  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET || 'brainros-reports';
  const region = process.env.S3_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT;

  if (accessKey && secretKey) {
    console.log(`  Target: S3 Bucket "${bucket}" in ${region} (Endpoint: ${endpoint || 'AWS Default'})`);
    const s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });

    const start = Date.now();
    try {
      // Safe, read-only: list max 1 object to test authentication & bucket presence
      await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      const elapsed = Date.now() - start;
      console.log(`✅ [OK] S3 Storage bucket "${bucket}" accessible in ${elapsed}ms`);
      return { success: true, service: 'Storage (S3)', latencyMs: elapsed };
    } catch (err) {
      const elapsed = Date.now() - start;
      console.warn(`⚠️ [WARNING] S3 Storage check failed (${elapsed}ms): ${err.message}. Local filesystem fallback will be used.`);
      return { success: false, service: 'Storage (S3)', error: err.message };
    }
  } else {
    const localDir = path.resolve(process.cwd(), 'storage', 'reports');
    const exists = fs.existsSync(localDir);
    console.log(`ℹ️ [INFO] S3 credentials not configured. Using local filesystem directory "${localDir}" (Exists: ${exists})`);
    return { success: true, service: 'Storage (Local Fallback)', details: `Directory: ${localDir}` };
  }
}

if (require.main === module) {
  testStorage().then((res) => process.exit(res.success ? 0 : 1));
}

module.exports = { testStorage };
