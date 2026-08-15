import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { acquireLease, releaseLease } from './lease.mjs';
import { generateDossiers } from './dossier.mjs';

export async function runPlaywright(options = {}) {
  const {
    patterns = [],
    project = null,
    workers = 1,
    config = 'playwright.config.ts',
    quiet = false,
    resultsJsonPath = '.playwright-lean/results.json',
  } = options;

  const resultsAbsPath = path.resolve(process.cwd(), resultsJsonPath);
  const resultsDir = path.dirname(resultsAbsPath);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // Acquire machine-wide run lease
  acquireLease({ quiet, info: `playwright run ${patterns.join(' ')}` });

  const args = [
    'playwright',
    'test',
    ...patterns,
    `--workers=${workers}`,
  ];

  let targetCwd = process.cwd();
  let resolvedConfig = config;
  if (!fs.existsSync(config) && fs.existsSync(path.join(process.cwd(), 'tests/playwright', config))) {
    targetCwd = path.join(process.cwd(), 'tests/playwright');
  }

  const configPathInCwd = path.join(targetCwd, resolvedConfig);
  if (!fs.existsSync(configPathInCwd)) {
    args.push('--reporter=json,line');
  } else {
    args.push(`--config=${resolvedConfig}`);
  }

  if (project) {
    args.push(`--project=${project}`);
  }

  if (!quiet) {
    process.stderr.write(`[playwright-lean] Executing: npx ${args.join(' ')} (in ${targetCwd})\n`);
  }

  const startTime = Date.now();
  let jsonOutput = '';
  let fullOutput = '';

  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn('npx', args, {
        cwd: targetCwd,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultsAbsPath,
        },
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;
        if (text.startsWith('{') || jsonOutput.length > 0) {
          jsonOutput += text;
        } else if (!quiet) {
          process.stdout.write(data);
        }
      });

      proc.stderr.on('data', (data) => {
        fullOutput += data.toString();
        if (!quiet) process.stderr.write(data);
      });

      proc.on('close', (code) => {
        const defaultResults = path.join(targetCwd, 'test-results/results.json');
        if (fs.existsSync(defaultResults) && fs.statSync(defaultResults).size > 0) {
          try {
            fs.copyFileSync(defaultResults, resultsAbsPath);
          } catch (e) {
            // ignore copy failure
          }
        } else if (jsonOutput.trim().startsWith('{')) {
          try {
            fs.writeFileSync(resultsAbsPath, jsonOutput, 'utf8');
          } catch (e) {
            // ignore
          }
        }
        resolve(code ?? 1);
      });
    });

    const durationMs = Date.now() - startTime;

    // Generate error dossiers & compute deltas immediately
    let dossierResult = null;
    let jsonTarget = resultsAbsPath;
    if (!fs.existsSync(jsonTarget) && fs.existsSync(path.resolve(process.cwd(), 'test-results/results.json'))) {
      jsonTarget = path.resolve(process.cwd(), 'test-results/results.json');
    }

    if (fs.existsSync(jsonTarget)) {
      try {
        dossierResult = generateDossiers(jsonTarget);
      } catch (err) {
        if (!quiet) {
          process.stderr.write(`[playwright-lean] Warning: Failed to generate dossiers: ${err.message}\n`);
        }
      }
    }

    return {
      exitCode,
      durationMs,
      resultsJsonPath: resultsAbsPath,
      dossier: dossierResult,
      fullOutput,
    };
  } finally {
    releaseLease();
  }
}
