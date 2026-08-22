import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI_BIN = path.resolve(process.cwd(), 'bin/playwright-lean.mjs');

test('Runner: configured Playwright projects always produce a fresh JSON report and dossier', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-lean-runner-'));
  fs.mkdirSync(path.join(tempDir, 'tests'));
  fs.symlinkSync(path.resolve(process.cwd(), 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(tempDir, 'playwright.config.mjs'), `
    export default { testDir: './tests', reporter: 'line' };
  `);
  fs.writeFileSync(path.join(tempDir, 'tests', 'failure.spec.mjs'), `
    import { test, expect } from 'playwright/test';
    test('writes a report', () => expect(1).toBe(2));
  `);

  const result = spawnSync(process.execPath, [CLI_BIN, 'run', '--config=playwright.config.mjs'], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Failed\*\*: 1/);
  assert.ok(fs.existsSync(path.join(tempDir, '.playwright-lean', 'results.json')));
  assert.ok(fs.existsSync(path.join(tempDir, '.playwright-lean', 'errors', 'CLUSTER-01.md')));

  fs.rmSync(tempDir, { recursive: true, force: true });
});
