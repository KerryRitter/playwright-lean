import fs from 'fs';
import path from 'path';

function scanFiles(dir, globPattern, fileList = []) {
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
        scanFiles(fullPath, globPattern, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      const rel = path.relative(process.cwd(), fullPath);
      if (!globPattern || rel.includes(globPattern)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export function runCodemod(findPattern, replacePattern, options = {}) {
  const { dryRun = false, glob = '', cwd = process.cwd(), targetDir = null } = options;
  const rootDir = targetDir || cwd;
  const files = scanFiles(rootDir, glob);

  const regex = typeof findPattern === 'string' ? new RegExp(findPattern, 'g') : findPattern;
  let modifiedCount = 0;
  let matchCount = 0;
  const modifiedFiles = [];

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const original = fs.readFileSync(file, 'utf8');

    if (regex.test(original)) {
      const matches = original.match(regex) || [];
      matchCount += matches.length;
      modifiedCount++;
      modifiedFiles.push({ file: rel, matchesCount: matches.length });

      const updated = original.replace(regex, replacePattern);
      if (!dryRun) {
        fs.writeFileSync(file, updated, 'utf8');
      }
    }
  }

  return {
    scannedCount: files.length,
    matchedFiles: modifiedCount,
    modifiedCount,
    filesModified: modifiedCount,
    totalReplacements: matchCount,
    matchCount,
    dryRun,
    modifiedFiles,
  };
}
