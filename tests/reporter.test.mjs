import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import PlaywrightLeanReporter from '../src/reporter.mjs';
import JestLeanReporter from '../src/jest-reporter.mjs';

test('Reporter: PlaywrightLeanReporter initializes and handles onBegin/onTestEnd/onEnd', async () => {
  const tmpDir = path.join(os.tmpdir(), `pw-reporter-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const reporter = new PlaywrightLeanReporter({
    outputDir: tmpDir,
    quiet: true,
  });

  reporter.onBegin({}, { allTests: () => [1, 2, 3] });
  assert.equal(reporter.total, 3);

  reporter.onTestEnd({}, { status: 'passed' });
  reporter.onTestEnd({}, { status: 'failed' });
  reporter.onTestEnd({}, { status: 'skipped' });

  assert.equal(reporter.passed, 1);
  assert.equal(reporter.failed, 1);
  assert.equal(reporter.skipped, 1);

  await reporter.onEnd({});
  assert.ok(fs.existsSync(path.join(tmpDir, 'results.json')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Reporter: zero-test setup failures retain the error and never emit a passing index', async () => {
  const tmpDir = path.join(os.tmpdir(), `pw-reporter-setup-error-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const reporter = new PlaywrightLeanReporter({ outputDir: tmpDir, quiet: true });
    reporter.onBegin({}, { allTests: () => [] });
    reporter.onError(Object.assign(new Error('setup exploded before collection'), {
      location: { file: 'global-setup.ts', line: 23, column: 3 },
    }));

    const dossier = await reporter.onEnd({ status: 'failed' });
    const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'results.json'), 'utf8'));

    assert.equal(report.errors.length, 1);
    assert.equal(dossier.summary.failed, 1);
    assert.equal(dossier.summary.clusterCount, 1);
    assert.match(dossier.indexMarkdown, /Playwright exited with code 1/);
    assert.match(dossier.indexMarkdown, /setup exploded before collection/);
    assert.doesNotMatch(dossier.indexMarkdown, /All tests passed/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reporter: JestLeanReporter onRunComplete clusters and writes dossiers', () => {
  const tmpDir = path.join(os.tmpdir(), `jest-reporter-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const reporter = new JestLeanReporter({}, { outputDir: tmpDir });

  const fakeJestResults = {
    numTotalTests: 1,
    numPassedTests: 0,
    numFailedTests: 1,
    testResults: [
      {
        name: 'test.spec.ts',
        status: 'failed',
        assertionResults: [
          {
            title: 'should prorate',
            status: 'failed',
            failureMessages: ['Error: Bad prorate\n    at Prorate.run (src/prorate.ts:10:5)'],
          },
        ],
      },
    ],
  };

  reporter.onRunComplete({}, fakeJestResults);

  assert.ok(fs.existsSync(path.join(tmpDir, 'jest-results.json')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'clusters.json')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
