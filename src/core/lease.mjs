import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_LEASE_PATH = path.join(os.homedir(), '.playwright-lean', 'run.lease');

export function getLeasePath(customPath) {
  return customPath || process.env.PW_LEAN_LEASE_FILE || DEFAULT_LEASE_PATH;
}

export function acquireLease(options = {}) {
  const leaseFile = getLeasePath(options.leasePath);
  const leaseDir = path.dirname(leaseFile);
  if (!fs.existsSync(leaseDir)) {
    fs.mkdirSync(leaseDir, { recursive: true });
  }

  const timeoutMs = options.timeoutMs || 30000;
  const pollIntervalMs = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      if (fs.existsSync(leaseFile)) {
        const content = fs.readFileSync(leaseFile, 'utf8').trim();
        const data = JSON.parse(content);
        const isAlive = isPidAlive(data.pid);

        if (isAlive) {
          if (!options.quiet) {
            process.stderr.write(`[playwright-lean] Runner lease held by PID ${data.pid} (${data.info || 'active run'}). Waiting...\n`);
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollIntervalMs);
          continue;
        } else {
          if (!options.quiet) {
            process.stderr.write(`[playwright-lean] Cleaning up stale lease from dead PID ${data.pid}\n`);
          }
          fs.unlinkSync(leaseFile);
        }
      }

      const leaseData = {
        pid: process.pid,
        time: new Date().toISOString(),
        info: options.info || 'playwright run',
      };
      fs.writeFileSync(leaseFile, JSON.stringify(leaseData, null, 2), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollIntervalMs);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to acquire playwright-lean machine lease within ${timeoutMs / 1000}s (${leaseFile})`);
}

export function releaseLease(options = {}) {
  const leaseFile = getLeasePath(options.leasePath);
  try {
    if (fs.existsSync(leaseFile)) {
      const content = fs.readFileSync(leaseFile, 'utf8').trim();
      const data = JSON.parse(content);
      if (data.pid === process.pid) {
        fs.unlinkSync(leaseFile);
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}
