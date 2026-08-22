import fs from 'fs';
import path from 'path';
import { isTestFile, shouldSkipDirectory } from './test-files.mjs';

function matchesFilter(filePath, filter) {
  if (!filter) return true;
  const normalizedPath = filePath.split(path.sep).join('/');
  const normalizedFilter = filter.split(path.sep).join('/');

  if (!/[?*]/.test(normalizedFilter)) {
    return normalizedPath.includes(normalizedFilter);
  }

  const pattern = normalizedFilter
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@GLOBSTAR_SLASH@@')
    .replace(/\*\*/g, '@@GLOBSTAR@@')
    .replace(/\*/g, '@@STAR@@')
    .replace(/\?/g, '@@QUESTION@@')
    .replace(/@@GLOBSTAR_SLASH@@/g, '(?:.*/)?')
    .replace(/@@GLOBSTAR@@/g, '.*')
    .replace(/@@STAR@@/g, '[^/]*')
    .replace(/@@QUESTION@@/g, '[^/]');
  return new RegExp(`^${pattern}$`).test(normalizedPath);
}

function scanFiles(dir, globPattern, fileList = [], rootDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        scanFiles(fullPath, globPattern, fileList, rootDir);
      }
    } else if (entry.isFile() && isTestFile(entry.name)) {
      const rel = path.relative(rootDir, fullPath);
      if (matchesFilter(rel, globPattern)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export function runCodemod(findPattern, replacePattern, options = {}) {
  const { dryRun = true, apply = false, glob = '', cwd = process.cwd(), targetDir = null } = options;
  if (!dryRun && !apply) {
    throw new Error('Refusing to modify files without explicit apply: true');
  }
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
