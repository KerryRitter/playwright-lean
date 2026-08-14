import fs from 'fs';
import path from 'path';

const AUDIT_RULES = [
  {
    id: 'BANNED_TEST_SKIP',
    severity: 'ERROR',
    description: 'Banned test.skip() or test.fixme() found in active test spec',
    pattern: /(?:^|[^\w$.])test\.(?:skip|fixme)\s*\(/,
    filter: (filePath) => !filePath.includes('_archive') && !filePath.includes('src/core/audit.mjs'),
  },
  {
    id: 'BANNED_TEST_ONLY',
    severity: 'ERROR',
    description: 'Banned test.only() found in active test spec',
    pattern: /(?:^|[^\w$.])test\.only\s*\(/,
    filter: (filePath) => !filePath.includes('_archive') && !filePath.includes('src/core/audit.mjs'),
  },
  {
    id: 'UNSAFE_FIXED_SLEEP',
    severity: 'WARN',
    description: 'Unsafe fixed page.waitForTimeout() sleep; prefer semantic waits',
    pattern: /page\.waitForTimeout\s*\(\s*\d+\s*\)/,
    filter: (filePath) => !filePath.includes('src/core/audit.mjs'),
  },
  {
    id: 'WEAKENED_STATUS_ASSERTION',
    severity: 'WARN',
    description: 'Weak status-family assertion (e.g. 200|400|500 regex or range)',
    pattern: /expect\(.*status.*\)\.toMatch\(\/200\||expect\(.*status.*\)\.toBeGreaterThanOrEqual\(/,
    filter: (filePath) => !filePath.includes('src/core/audit.mjs'),
  },
];

function scanDirectory(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== '.playwright-lean' &&
        entry.name !== '.playlite' &&
        entry.name !== 'test-results' &&
        entry.name !== 'dist' &&
        entry.name !== '.git'
      ) {
        scanDirectory(fullPath, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export function auditCodebase(targetDir = process.cwd()) {
  const files = scanDirectory(targetDir);
  const issues = [];

  for (const file of files) {
    const relativePath = path.relative(targetDir, file);
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((lineText, lineIdx) => {
      const lineNum = lineIdx + 1;
      for (const rule of AUDIT_RULES) {
        if (rule.filter(relativePath) && rule.pattern.test(lineText)) {
          issues.push({
            rule: rule.id,
            severity: rule.severity,
            file: relativePath,
            line: lineNum,
            snippet: lineText.trim(),
            description: rule.description,
          });
        }
      }
    });
  }

  const errors = issues.filter((v) => v.severity === 'ERROR').length;
  const warnings = issues.filter((v) => v.severity === 'WARN').length;

  return {
    scannedFiles: files.length,
    totalIssues: issues.length,
    errors,
    warnings,
    issues,
  };
}
