import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runCodemod } from '../src/core/codemod.mjs';

test('Codemod Engine: applies regex transformations and dry runs', () => {
  const tempDir = path.join(os.tmpdir(), `pw-lean-codemod-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const specPath = path.join(tempDir, 'sample.spec.ts');
  fs.writeFileSync(specPath, 'expect(status).toBe(200);', 'utf8');
  const sourcePath = path.join(tempDir, 'app.ts');
  fs.writeFileSync(sourcePath, 'expect(status).toBe(200);', 'utf8');

  // Dry run
  const dryRes = runCodemod('toBe\\(200\\)', 'toBe(201)', {
    dryRun: true,
    targetDir: tempDir,
  });
  assert.equal(dryRes.matchedFiles, 1);
  assert.equal(dryRes.totalReplacements, 1);
  assert.equal(fs.readFileSync(specPath, 'utf8'), 'expect(status).toBe(200);');

  const globRes = runCodemod('toBe\\(200\\)', 'toBe(201)', {
    glob: '**/sample.spec.ts',
    targetDir: tempDir,
  });
  assert.equal(globRes.matchedFiles, 1);

  // Real run
  const realRes = runCodemod('toBe\\(200\\)', 'toBe(201)', {
    dryRun: false,
    apply: true,
    targetDir: tempDir,
  });
  assert.equal(realRes.totalReplacements, 1);
  assert.equal(fs.readFileSync(specPath, 'utf8'), 'expect(status).toBe(201);');
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'expect(status).toBe(200);');

  fs.rmSync(tempDir, { recursive: true, force: true });
});
