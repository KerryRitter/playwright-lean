import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_LEASE_PATH = path.join(
  os.homedir(),
  '.zipper-agent',
  'playwright-run.lease',
);
const POLL_INTERVAL_MS = 500;

export function getLeasePath(customPath) {
  return customPath || process.env.PW_LEAN_LEASE_FILE || DEFAULT_LEASE_PATH;
}

function wait() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_INTERVAL_MS);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readOwner(leaseFile) {
  try {
    return JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
  } catch {
    return null;
  }
}

function reclaimStaleLease(leaseFile) {
  const reclaimFile = `${leaseFile}.reclaim`;
  if (!tryCreateLease(reclaimFile, 'playwright lease reclamation')) return false;
  try {
    const currentOwner = readOwner(leaseFile);
    if (currentOwner && isPidAlive(currentOwner.pid)) return false;
    try {
      fs.unlinkSync(leaseFile);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return true;
  } finally {
    releaseOwnedLease(reclaimFile);
  }
}

function tryCreateLease(leaseFile, info) {
  const tempFile = `${leaseFile}.${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  const owner = JSON.stringify(
    {
      pid: process.pid,
      time: new Date().toISOString(),
      info,
    },
    null,
    2,
  );
  fs.writeFileSync(tempFile, owner, { flag: 'wx', mode: 0o600 });
  try {
    fs.linkSync(tempFile, leaseFile);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  } finally {
    fs.unlinkSync(tempFile);
  }
}

function releaseOwnedLease(leaseFile) {
  const owner = readOwner(leaseFile);
  if (owner?.pid === process.pid) {
    fs.unlinkSync(leaseFile);
  }
}

export function acquireLease(options = {}) {
  const leaseFile = getLeasePath(options.leasePath);
  const leaseDir = path.dirname(leaseFile);
  if (!fs.existsSync(leaseDir)) {
    fs.mkdirSync(leaseDir, { recursive: true });
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (tryCreateLease(leaseFile, options.info || 'playwright run')) return true;

    const owner = readOwner(leaseFile);
    if (owner && isPidAlive(owner.pid)) {
      if (!options.quiet) {
        process.stderr.write(
          `[playwright-lean] Runner lease held by PID ${owner.pid} (${owner.info || 'active run'}). Waiting...\n`,
        );
      }
      wait();
      continue;
    }

    if (!options.quiet) {
      const description = owner?.pid
        ? `dead PID ${owner.pid}`
        : 'invalid owner metadata';
      process.stderr.write(
        `[playwright-lean] Reclaiming stale lease from ${description}\n`,
      );
    }
    if (!reclaimStaleLease(leaseFile)) wait();
  }

  throw new Error(
    `Failed to acquire playwright-lean machine lease within ${timeoutMs / 1000}s (${leaseFile})`,
  );
}

export function releaseLease(options = {}) {
  releaseOwnedLease(getLeasePath(options.leasePath));
}
