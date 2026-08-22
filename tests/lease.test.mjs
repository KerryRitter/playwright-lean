import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { acquireLease, releaseLease, getLeasePath } from '../src/core/lease.mjs';

test('Lease Manager: acquires and releases lease cleanly', () => {
  const tempLeasePath = path.join(os.tmpdir(), `pw-lean-test-lease-${Date.now()}.lease`);
  
  // Acquire lease
  const acquired = acquireLease({ leasePath: tempLeasePath, quiet: true });
  assert.equal(acquired, true);
  const lockDir = `${tempLeasePath}.lock`;
  assert.equal(fs.existsSync(lockDir), true);

  const content = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(content.pid, process.pid);

  // Release lease
  releaseLease({ leasePath: tempLeasePath });
  assert.equal(fs.existsSync(lockDir), false);
});

test('Lease Manager: reclaims stale lease from non-existent PID', () => {
  const tempLeasePath = path.join(os.tmpdir(), `pw-lean-stale-lease-${Date.now()}.lease`);
  
  // Write fake lease with dead PID (e.g. 999999)
  const lockDir = `${tempLeasePath}.lock`;
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999, time: new Date().toISOString() }));

  const acquired = acquireLease({ leasePath: tempLeasePath, quiet: true, timeoutMs: 2000 });
  assert.equal(acquired, true);

  const content = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(content.pid, process.pid);

  releaseLease({ leasePath: tempLeasePath });
});
