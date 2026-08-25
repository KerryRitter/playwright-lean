import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  acquireLease,
  getLeasePath,
  releaseLease,
} from '../src/core/lease.mjs';

test('Lease Manager: defaults to the shared Zipper machine lease', () => {
  const previous = process.env.PW_LEAN_LEASE_FILE;
  delete process.env.PW_LEAN_LEASE_FILE;
  try {
    assert.equal(
      getLeasePath(),
      path.join(os.homedir(), '.zipper-agent', 'playwright-run.lease'),
    );
  } finally {
    if (previous === undefined) delete process.env.PW_LEAN_LEASE_FILE;
    else process.env.PW_LEAN_LEASE_FILE = previous;
  }
});

test('Lease Manager: acquires and releases lease cleanly', () => {
  const tempLeasePath = path.join(
    os.tmpdir(),
    `pw-lean-test-lease-${Date.now()}.lease`,
  );

  const acquired = acquireLease({ leasePath: tempLeasePath, quiet: true });
  assert.equal(acquired, true);
  assert.equal(fs.existsSync(tempLeasePath), true);
  assert.equal(
    JSON.parse(fs.readFileSync(tempLeasePath, 'utf8')).pid,
    process.pid,
  );

  releaseLease({ leasePath: tempLeasePath });
  assert.equal(fs.existsSync(tempLeasePath), false);
});

test('Lease Manager: reclaims stale lease from non-existent PID', () => {
  const tempLeasePath = path.join(
    os.tmpdir(),
    `pw-lean-stale-lease-${Date.now()}.lease`,
  );
  fs.writeFileSync(
    tempLeasePath,
    JSON.stringify({ pid: 999999, time: new Date().toISOString() }),
  );

  const acquired = acquireLease({
    leasePath: tempLeasePath,
    quiet: true,
    timeoutMs: 2000,
  });
  assert.equal(acquired, true);
  assert.equal(
    JSON.parse(fs.readFileSync(tempLeasePath, 'utf8')).pid,
    process.pid,
  );

  releaseLease({ leasePath: tempLeasePath });
  assert.equal(fs.existsSync(tempLeasePath), false);
});

test('Lease Manager: reclaims an empty legacy lease file', () => {
  const tempLeasePath = path.join(
    os.tmpdir(),
    `pw-lean-empty-lease-${Date.now()}.lease`,
  );
  fs.writeFileSync(tempLeasePath, '');

  const acquired = acquireLease({
    leasePath: tempLeasePath,
    quiet: true,
    timeoutMs: 2000,
  });
  assert.equal(acquired, true);
  assert.equal(
    JSON.parse(fs.readFileSync(tempLeasePath, 'utf8')).pid,
    process.pid,
  );

  releaseLease({ leasePath: tempLeasePath });
  assert.equal(fs.existsSync(tempLeasePath), false);
});

test('Lease Manager: does not replace a lease owned by a live PID', () => {
  const tempLeasePath = path.join(
    os.tmpdir(),
    `pw-lean-live-lease-${Date.now()}.lease`,
  );
  acquireLease({ leasePath: tempLeasePath, quiet: true });

  try {
    assert.throws(
      () =>
        acquireLease({
          leasePath: tempLeasePath,
          quiet: true,
          timeoutMs: 50,
        }),
      /Failed to acquire playwright-lean machine lease/,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(tempLeasePath, 'utf8')).pid,
      process.pid,
    );
  } finally {
    releaseLease({ leasePath: tempLeasePath });
  }
});

test('Lease Manager: does not reclaim while another reclaimer owns the guard', () => {
  const tempLeasePath = path.join(
    os.tmpdir(),
    `pw-lean-reclaim-guard-${Date.now()}.lease`,
  );
  const reclaimPath = `${tempLeasePath}.reclaim`;
  fs.writeFileSync(
    tempLeasePath,
    JSON.stringify({ pid: 999999, time: new Date().toISOString() }),
  );
  fs.writeFileSync(
    reclaimPath,
    JSON.stringify({ pid: process.pid, time: new Date().toISOString() }),
  );

  try {
    assert.throws(
      () =>
        acquireLease({
          leasePath: tempLeasePath,
          quiet: true,
          timeoutMs: 50,
        }),
      /Failed to acquire playwright-lean machine lease/,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(tempLeasePath, 'utf8')).pid,
      999999,
    );
  } finally {
    fs.unlinkSync(reclaimPath);
    fs.unlinkSync(tempLeasePath);
  }
});
