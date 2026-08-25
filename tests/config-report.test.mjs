import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { inspectConfigReporters } from '../src/core/config-report.mjs';

function inspect(source) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-lean-config-report-'));
  const configPath = path.join(tempDir, 'playwright.config.ts');
  try {
    fs.writeFileSync(configPath, source);
    return inspectConfigReporters(configPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Config reporter inspection finds configured JSON output', () => {
  const result = inspect(`
    export default {
      reporter: [
        ['line'],
        ['json', { outputFile: 'test-results/results.json' }],
        ['./strict-completion-reporter.ts'],
      ],
    };
  `);

  assert.deepEqual(result, {
    hasMachineReadable: true,
    outputFile: 'test-results/results.json',
    outputDir: null,
    reporter: 'json',
  });
});

test('Config reporter inspection supports the native playwright-lean reporter defaults', () => {
  const result = inspect(`
    export default {
      reporter: [['playwright-lean/reporter', { outputDir: 'artifacts/lean' }]],
    };
  `);

  assert.deepEqual(result, {
    hasMachineReadable: true,
    outputFile: null,
    outputDir: 'artifacts/lean',
    reporter: 'playwright-lean/reporter',
  });
});

test('Config reporter inspection ignores comments and non-machine-readable reporters', () => {
  const result = inspect(`
    // reporter: 'json'
    export default {
      reporter: 'line',
    };
  `);

  assert.deepEqual(result, {
    hasMachineReadable: false,
    outputFile: null,
    outputDir: null,
    reporter: null,
  });
});
