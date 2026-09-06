const fs = require('fs');
const path = require('path');

function getFiles(dir, files = []) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      getFiles(full, files);
    } else if (file.endsWith('.controller.ts')) {
      files.push(full);
    }
  }
  return files;
}

const controllers = getFiles(path.join(__dirname, '..', 'src'));
const endpoints = [];

controllers.forEach((ctrlFile) => {
  const content = fs.readFileSync(ctrlFile, 'utf8');
  let prefixes = [''];

  const ctrlMatch = content.match(/@Controller\s*\(([^)]*)\)/);
  if (ctrlMatch && ctrlMatch[1]) {
    const raw = ctrlMatch[1].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      prefixes = raw
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''));
    } else if (raw) {
      prefixes = [raw.replace(/['"]/g, '')];
    }
  }

  const methodRegex = /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(([^)]*)\)/g;
  let m;
  while ((m = methodRegex.exec(content)) !== null) {
    const method = m[1].toUpperCase();
    let rawPath = (m[2] || '').trim();
    let subPaths = [''];

    if (rawPath.startsWith('[') && rawPath.endsWith(']')) {
      subPaths = rawPath
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''));
    } else if (rawPath) {
      subPaths = [rawPath.replace(/['"]/g, '')];
    }

    prefixes.forEach((p) => {
      subPaths.forEach((sub) => {
        let cleanP = p ? (p.startsWith('/') ? p : '/' + p) : '';
        if (cleanP.endsWith('/')) cleanP = cleanP.slice(0, -1);
        let cleanSub = sub ? (sub.startsWith('/') ? sub : '/' + sub) : '';
        let full = cleanP + cleanSub;
        if (!full || full === '') full = '/';
        endpoints.push({
          file: path.relative(path.join(__dirname, '..'), ctrlFile),
          method,
          path: full,
        });
      });
    });
  }
});

const grouped = {};
endpoints.forEach((ep) => {
  const moduleName = ep.file.includes('modules')
    ? ep.file.split('modules')[1].split(path.sep)[1]
    : 'core';
  if (!grouped[moduleName]) grouped[moduleName] = [];
  grouped[moduleName].push(ep);
});

let md = `# Brainros Backend API Endpoints Directory\n\nTotal Endpoints: **${endpoints.length}**\n\n`;

for (const [mod, list] of Object.entries(grouped)) {
  md += `### ${mod.toUpperCase()} (${list.length} endpoints)\n`;
  md += `| Method | Route Path |\n`;
  md += `|---|---|\n`;
  list.forEach((e) => {
    md += `| \`${e.method}\` | \`${e.path}\` |\n`;
  });
  md += `\n`;
}

fs.writeFileSync(path.join(__dirname, 'endpoints_dump.md'), md);
console.log('Successfully written to endpoints_dump.md. Total:', endpoints.length);
