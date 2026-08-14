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
    `--reporter=json,list`,
    `--workers=${workers}`,
  ];

  if (project) {
    args.push(`--project=${project}`);
  }
  if (config && fs.existsSync(config)) {
    args.push(`--config=${config}`);
  }

  if (!quiet) {
    process.stderr.write(`[playwright-lean] Executing: npx ${args.join(' ')}\n`);
  }

  const startTime = Date.now();
  let jsonOutput = '';
  let fullOutput = '';

  const jsonStream = fs.createWriteStream(resultsAbsPath);

  try {
    const exitCode = await new Promise((resolve) => {
      const proc = spawn('npx', args, {
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
          jsonStream.write(data);
        } else if (!quiet) {
          process.stdout.write(data);
        }
      });

      proc.stderr.on('data', (data) => {
        fullOutput += data.toString();
        if (!quiet) process.stderr.write(data);
      });

      proc.on('close', (code) => {
        jsonStream.end();
        resolve(code ?? 1);
      });
    });

    const durationMs = Date.now() - startTime;

    // Generate error dossiers & compute deltas immediately
    let dossierResult = null;
    if (fs.existsSync(resultsAbsPath)) {
      try {
        dossierResult = generateDossiers(resultsAbsPath);
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
