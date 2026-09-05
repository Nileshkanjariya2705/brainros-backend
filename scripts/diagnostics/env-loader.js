const fs = require('fs');
const path = require('path');

function loadEnv() {
  const rootDir = path.resolve(__dirname, '../..');
  const envProdPath = path.join(rootDir, '.env.production');
  const envPath = path.join(rootDir, '.env');

  const targetPath =
    process.env.NODE_ENV === 'production' && fs.existsSync(envProdPath)
      ? envProdPath
      : fs.existsSync(envPath)
        ? envPath
        : fs.existsSync(envProdPath)
          ? envProdPath
          : null;

  if (targetPath) {
    const content = fs.readFileSync(targetPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx > 0) {
        const key = trimmed.substring(0, equalsIdx).trim();
        let value = trimmed.substring(equalsIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

module.exports = { loadEnv };
