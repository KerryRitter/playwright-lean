import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_LEASE_PATH = path.join(os.homedir(), '.playwright-lean', 'run.lease');
const POLL_INTERVAL_MS = 500;

export function getLeasePath(customPath) {
  return customPath || process.env.PW_LEAN_LEASE_FILE || DEFAULT_LEASE_PATH;
}

function getLockDir(leaseFile) {
  return `${leaseFile}.lock`;
}

function getOwnerFile(lockDir) {
  return path.join(lockDir, 'owner.json');
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

function readOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(getOwnerFile(lockDir), 'utf8'));
  } catch {
    return null;
  }
}

function reclaimStaleLock(lockDir) {
  const quarantinedDir = `${lockDir}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lockDir, quarantinedDir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  fs.rmSync(quarantinedDir, { recursive: true, force: true });
}

export function acquireLease(options = {}) {
  const leaseFile = getLeasePath(options.leasePath);
  const leaseDir = path.dirname(leaseFile);
  const lockDir = getLockDir(leaseFile);
  if (!fs.existsSync(leaseDir)) {
    fs.mkdirSync(leaseDir, { recursive: true });
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(getOwnerFile(lockDir), JSON.stringify({
        pid: process.pid,
        time: new Date().toISOString(),
        info: options.info || 'playwright run',
      }, null, 2));
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const owner = readOwner(lockDir);
      if (owner && isPidAlive(owner.pid)) {
        if (!options.quiet) {
          process.stderr.write(`[playwright-lean] Runner lease held by PID ${owner.pid} (${owner.info || 'active run'}). Waiting...\n`);
        }
        wait();
        continue;
      }

      if (!options.quiet) {
        const description = owner?.pid ? `dead PID ${owner.pid}` : 'invalid owner metadata';
        process.stderr.write(`[playwright-lean] Reclaiming stale lease from ${description}\n`);
      }
      reclaimStaleLock(lockDir);
    }
  }

  throw new Error(`Failed to acquire playwright-lean machine lease within ${timeoutMs / 1000}s (${leaseFile})`);
}

export function releaseLease(options = {}) {
  const leaseFile = getLeasePath(options.leasePath);
  const lockDir = getLockDir(leaseFile);
  const owner = readOwner(lockDir);
  if (owner?.pid === process.pid) {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}
