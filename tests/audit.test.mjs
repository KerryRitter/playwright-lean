import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { auditCodebase } from '../src/core/audit.mjs';

test('Audit Engine: detects banned test.skip and fixed sleeps', () => {
  const tempDir = path.join(os.tmpdir(), `pw-lean-audit-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const badSpecPath = path.join(tempDir, 'bad.spec.ts');
  fs.writeFileSync(
    badSpecPath,
    `
    test.skip('skipped test', async ({ page }) => {
      await page.waitForTimeout(500);
      expect(response.status()).toMatch(/200|400|500/);
    });
  `,
    'utf8'
  );

  const result = auditCodebase(tempDir);

  assert.equal(result.scannedFiles, 1);
  assert.equal(result.errors, 1); // test.skip
  assert.equal(result.warnings, 2); // waitForTimeout, toMatch regex

  const rules = result.issues.map((i) => i.rule);
  assert.ok(rules.includes('BANNED_TEST_SKIP'));
  assert.ok(rules.includes('UNSAFE_FIXED_SLEEP'));
  assert.ok(rules.includes('WEAKENED_STATUS_ASSERTION'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});
