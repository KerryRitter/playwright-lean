import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { acquireLease, releaseLease } from './lease.mjs';
import { generateDossiers } from './dossier.mjs';
import { inspectConfigReporters } from './config-report.mjs';

const require = createRequire(import.meta.url);
const BUNDLED_PLAYWRIGHT_CLI = path.join(path.dirname(require.resolve('playwright')), 'cli.js');
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

export function resolvePlaywrightCli(targetCwd) {
  try {
    const targetRequire = createRequire(path.join(targetCwd, 'package.json'));
    const packageEntry = targetRequire.resolve('playwright');
    const cliPath = path.join(path.dirname(packageEntry), 'cli.js');
    if (fs.existsSync(cliPath)) return cliPath;
  } catch {
    // A standalone caller may not have Playwright installed; use our dependency.
  }
  return BUNDLED_PLAYWRIGHT_CLI;
}

function removePreviousReport(reportPath) {
  if (!fs.existsSync(reportPath)) return;
  const stat = fs.lstatSync(reportPath);
  if (!stat.isFile()) {
    throw new Error(`Results path exists but is not a file: ${reportPath}`);
  }
  fs.unlinkSync(reportPath);
}

function configuredReportPath(configReport, targetCwd, resultsAbsPath) {
  if (!configReport.hasMachineReadable) return null;
  if (configReport.outputFile) return path.resolve(targetCwd, configReport.outputFile);
  if (configReport.reporter === 'playwright-lean/reporter') {
    return path.resolve(targetCwd, configReport.outputDir || '.playwright-lean', 'results.json');
  }
  return resultsAbsPath;
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
    const { targetCwd, configPath } = resolveConfig(config);
    const playwrightCli = resolvePlaywrightCli(targetCwd);
    const configReport = inspectConfigReporters(configPath);
    const configuredResultsPath = configuredReportPath(configReport, targetCwd, resultsAbsPath);

    removePreviousReport(resultsAbsPath);
    if (configuredResultsPath && configuredResultsPath !== resultsAbsPath) {
      removePreviousReport(configuredResultsPath);
    }

    const args = [
      playwrightCli,
      'test',
      ...patterns,
      `--workers=${workers}`,
    ];

    if (!configReport.hasMachineReadable) {
      args.push('--reporter=json,line');
    }

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
      const childEnv = { ...process.env };
      if (!configReport.hasMachineReadable || (configReport.reporter === 'json' && !configReport.outputFile)) {
        childEnv.PLAYWRIGHT_JSON_OUTPUT_FILE = resultsAbsPath;
      } else {
        delete childEnv.PLAYWRIGHT_JSON_OUTPUT_FILE;
      }

      const proc = spawn(process.execPath, args, {
        cwd: targetCwd,
        env: childEnv,
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

    const producedReportPath = configuredResultsPath && fs.existsSync(configuredResultsPath)
      ? configuredResultsPath
      : fs.existsSync(resultsAbsPath)
        ? resultsAbsPath
        : null;

    if (producedReportPath) {
      if (producedReportPath !== resultsAbsPath) {
        fs.copyFileSync(producedReportPath, resultsAbsPath);
      }
      dossierResult = generateDossiers(resultsAbsPath, undefined, { exitCode });
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
      usedConfiguredReporter: configReport.hasMachineReadable,
      playwrightCliPath: playwrightCli,
    };
  } finally {
    releaseLease();
  }
}
