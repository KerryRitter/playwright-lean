const TEST_FILE_PATTERN = /\.(?:spec|test)\.(?:[cm]?[jt]sx?)$/i;

export function isTestFile(filePath = '') {
  return TEST_FILE_PATTERN.test(filePath);
}

export function shouldSkipDirectory(name) {
  return new Set([
    'node_modules',
    '.git',
    '.playwright-lean',
    'test-results',
    'playwright-report',
    'blob-report',
    '.vitest',
    'coverage',
    '.nyc_output',
    '.cache',
    'dist',
    'build',
    'out',
  ]).has(name);
}
