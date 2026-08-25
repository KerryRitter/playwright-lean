import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePlaywrightCli } from '../src/core/runner.mjs';

const CLI_BIN = path.resolve(process.cwd(), 'bin/playwright-lean.mjs');

function createProject(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tempDir, 'tests'));
  fs.symlinkSync(path.resolve(process.cwd(), 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  return tempDir;
}

function createProjectWithLocalReporter(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tempDir, 'tests'));
  fs.mkdirSync(path.join(tempDir, 'node_modules'));
  fs.symlinkSync(process.cwd(), path.join(tempDir, 'node_modules', 'playwright-lean'), 'dir');
  fs.symlinkSync(
    path.resolve(process.cwd(), 'node_modules', 'playwright'),
    path.join(tempDir, 'node_modules', 'playwright'),
    'dir',
  );
  return tempDir;
}

function run(tempDir) {
  return spawnSync(process.execPath, [CLI_BIN, 'run', '--config=playwright.config.mjs'], {
    cwd: tempDir,
    encoding: 'utf8',
  });
}

test('Runner: resolves Playwright from the consumer project before the bundled fallback', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-lean-consumer-cli-'));
  try {
    const packageDir = path.join(tempDir, 'node_modules', 'playwright');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
    fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(packageDir, 'cli.js'), '#!/usr/bin/env node');

    assert.equal(resolvePlaywrightCli(tempDir), path.join(packageDir, 'cli.js'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Runner: configured Playwright projects always produce a fresh JSON report and dossier', () => {
  const tempDir = createProject('pw-lean-runner-');
  try {
    fs.writeFileSync(path.join(tempDir, 'playwright.config.mjs'), `
      export default { testDir: './tests', reporter: 'line' };
    `);
    fs.writeFileSync(path.join(tempDir, 'tests', 'failure.spec.mjs'), `
      import { test, expect } from 'playwright/test';
      test('writes a report', () => expect(1).toBe(2));
    `);

    const result = run(tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Failed\*\*: 1/);
    assert.ok(fs.existsSync(path.join(tempDir, '.playwright-lean', 'results.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.playwright-lean', 'errors', 'CLUSTER-01.md')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Runner: preserves configured reporters and copies their JSON report', () => {
  const tempDir = createProject('pw-lean-configured-reporter-');
  try {
    fs.writeFileSync(path.join(tempDir, 'playwright.config.mjs'), `
      export default {
        testDir: './tests',
        globalSetup: './global-setup.mjs',
        reporter: [
          ['line'],
          ['json', { outputFile: 'test-results/results.json' }],
        ],
      };
    `);
    fs.writeFileSync(path.join(tempDir, 'global-setup.mjs'), `
      export default async function globalSetup() {
        if (process.argv.some((arg) => arg === '--reporter' || arg.startsWith('--reporter='))) {
          throw new Error('CLI reporter override rejected');
        }
      }
    `);
    fs.writeFileSync(path.join(tempDir, 'tests', 'passing.spec.mjs'), `
      import { test, expect } from 'playwright/test';
      test('uses configured reporters', () => expect(1).toBe(1));
    `);

    const result = run(tempDir);
    const stableReport = path.join(tempDir, '.playwright-lean', 'results.json');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Total\*\*: 1/);
    assert.ok(fs.existsSync(path.join(tempDir, 'test-results', 'results.json')));
    assert.ok(fs.existsSync(stableReport));
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(stableReport, 'utf8')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Runner: setup failures cannot reuse stale green reports or print a false pass', () => {
  const tempDir = createProject('pw-lean-stale-report-');
  try {
    fs.mkdirSync(path.join(tempDir, 'test-results'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.playwright-lean'), { recursive: true });
    const staleReport = JSON.stringify({ suites: [], staleSentinel: true });
    fs.writeFileSync(path.join(tempDir, 'test-results', 'results.json'), staleReport);
    fs.writeFileSync(path.join(tempDir, '.playwright-lean', 'results.json'), staleReport);
    fs.writeFileSync(path.join(tempDir, 'playwright.config.mjs'), `
      export default {
        testDir: './tests',
        globalSetup: './global-setup.mjs',
        reporter: [['json', { outputFile: 'test-results/results.json' }]],
      };
    `);
    fs.writeFileSync(path.join(tempDir, 'global-setup.mjs'), `
      export default async function globalSetup() {
        throw new Error('setup exploded before collection');
      }
    `);
    fs.writeFileSync(path.join(tempDir, 'tests', 'never-runs.spec.mjs'), `
      import { test } from 'playwright/test';
      test('never runs', () => {});
    `);

    const result = run(tempDir);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const possibleReports = [
      path.join(tempDir, 'test-results', 'results.json'),
      path.join(tempDir, '.playwright-lean', 'results.json'),
    ];

    assert.equal(result.status, 1);
    assert.doesNotMatch(combinedOutput, /All tests passed/);
    for (const reportPath of possibleReports) {
      if (fs.existsSync(reportPath)) {
        assert.doesNotMatch(fs.readFileSync(reportPath, 'utf8'), /staleSentinel/);
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Runner: shared JSON and lean reporters retain global setup failures', () => {
  const tempDir = createProjectWithLocalReporter('pw-lean-shared-report-');
  try {
    fs.writeFileSync(path.join(tempDir, 'playwright.config.mjs'), `
      export default {
        testDir: './tests',
        globalSetup: './global-setup.mjs',
        reporter: [
          ['json', { outputFile: 'test-results/results.json' }],
          ['playwright-lean/reporter', { outputFile: 'test-results/results.json', quiet: true }],
        ],
      };
    `);
    fs.writeFileSync(path.join(tempDir, 'global-setup.mjs'), `
      export default async function globalSetup() {
        if (process.argv.some((arg) => arg === '--reporter' || arg.startsWith('--reporter='))) {
          throw new Error('CLI reporter override rejected');
        }
        throw new Error('setup exploded before collection');
      }
    `);
    fs.writeFileSync(path.join(tempDir, 'tests', 'never-runs.spec.mjs'), `
      import { test } from 'playwright/test';
      test('never runs', () => {});
    `);

    const result = run(tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Failed\*\*: 1/);
    assert.match(result.stdout, /setup exploded before collection/);
    assert.doesNotMatch(result.stdout, /All tests passed/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /CLI reporter override rejected/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
