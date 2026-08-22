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
