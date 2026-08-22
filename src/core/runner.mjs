import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { acquireLease, releaseLease } from './lease.mjs';
import { generateDossiers } from './dossier.mjs';

const require = createRequire(import.meta.url);
const PLAYWRIGHT_CLI = path.join(path.dirname(require.resolve('playwright')), 'cli.js');
const MAX_CAPTURED_OUTPUT_CHARS = 10_000;
const DEFAULT_CONFIGS = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];

function resolveConfig(config) {
  const roots = [process.cwd(), path.join(process.cwd(), 'tests/playwright')];
  const candidates = config ? [config] : DEFAULT_CONFIGS;

  for (const root of roots) {
    for (const candidate of candidates) {
      const configPath = path.resolve(root, candidate);
      if (fs.existsSync(configPath)) {
        return { targetCwd: root, configPath };
      }
    }
  }

  if (config) {
    throw new Error(`Playwright config not found: ${config}`);
  }

  return { targetCwd: process.cwd(), configPath: null };
}

function removePreviousReport(reportPath) {
  if (!fs.existsSync(reportPath)) return;
  const stat = fs.lstatSync(reportPath);
  if (!stat.isFile()) {
    throw new Error(`Results path exists but is not a file: ${reportPath}`);
  }
  fs.unlinkSync(reportPath);
}

export async function runPlaywright(options = {}) {
  const {
    patterns = [],
    project = null,
    workers = 1,
    config = null,
    quiet = false,
    resultsJsonPath = '.playwright-lean/results.json',
    maxOutputChars = MAX_CAPTURED_OUTPUT_CHARS,
  } = options;

  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`workers must be a positive integer; received ${workers}`);
  }

  const resultsAbsPath = path.resolve(process.cwd(), resultsJsonPath);
  const resultsDir = path.dirname(resultsAbsPath);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  acquireLease({ quiet, info: `playwright run ${patterns.join(' ')}` });

  try {
    removePreviousReport(resultsAbsPath);

    const { targetCwd, configPath } = resolveConfig(config);
    const args = [
      PLAYWRIGHT_CLI,
      'test',
      ...patterns,
      `--workers=${workers}`,
      '--reporter=json,line',
    ];

    if (configPath) {
      args.push(`--config=${configPath}`);
    }
    if (project) {
      args.push(`--project=${project}`);
    }

    if (!quiet) {
      process.stderr.write(`[playwright-lean] Executing: playwright test ${patterns.join(' ')} (in ${targetCwd})\n`);
    }

    const startTime = Date.now();
    let fullOutput = '';
    let outputTruncated = false;
    const appendOutput = (chunk) => {
      if (fullOutput.length >= maxOutputChars) {
        outputTruncated = true;
        return;
      }
      const remaining = maxOutputChars - fullOutput.length;
      fullOutput += chunk.slice(0, remaining);
      outputTruncated ||= chunk.length > remaining;
    };

    const exitCode = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, args, {
        cwd: targetCwd,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_FILE: resultsAbsPath,
        },
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      proc.on('error', (err) => reject(new Error(`Could not start Playwright: ${err.message}`)));
      proc.stdout.on('data', (data) => {
        const text = data.toString();
        appendOutput(text);
        if (!quiet) process.stdout.write(data);
      });
      proc.stderr.on('data', (data) => {
        const text = data.toString();
        appendOutput(text);
        if (!quiet) process.stderr.write(data);
      });
      proc.on('close', (code) => resolve(code ?? 1));
    });

    const durationMs = Date.now() - startTime;
    let dossierResult = null;

    if (fs.existsSync(resultsAbsPath)) {
      dossierResult = generateDossiers(resultsAbsPath);
    } else {
      process.stderr.write(`[playwright-lean] No JSON report was produced at ${resultsAbsPath}.\n`);
    }

    return {
      exitCode,
      durationMs,
      resultsJsonPath: resultsAbsPath,
      dossier: dossierResult,
      fullOutput,
      outputTruncated,
    };
  } finally {
    releaseLease();
  }
}
