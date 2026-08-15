import fs from 'fs';
import path from 'path';
import { clusterResults } from './core/cluster.mjs';
import { generateDossiers } from './core/dossier.mjs';

/**
 * PlaywrightLeanReporter
 * 
 * Native Playwright reporter that:
 * 1. Suppresses massive per-test stdout spam
 * 2. Writes deterministic results.json
 * 3. Automatically clusters errors into 0-token root cause signatures
 * 4. Generates on-demand markdown dossiers in .playwright-lean/errors/
 * 5. Emits an ultra-lean (<150 token) markdown summary index table
 */
export default class PlaywrightLeanReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || '.playwright-lean/results.json';
    this.outputDir = options.outputDir || (this.outputFile.includes('/') ? path.dirname(this.outputFile) : '.playwright-lean');
    this.quiet = options.quiet ?? false;
    this.total = 0;
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.suiteTree = { suites: [] };
  }

  onBegin(config, suite) {
    this.total = suite.allTests().length;
    if (!this.quiet) {
      process.stderr.write(`[pw-lean] Executing ${this.total} tests with Playwright-Lean...\n`);
    }
  }

  onTestEnd(test, result) {
    if (result.status === 'passed') {
      this.passed++;
    } else if (result.status === 'skipped') {
      this.skipped++;
    } else {
      this.failed++;
    }
  }

  async onEnd(result) {
    const outDir = path.resolve(process.cwd(), this.outputDir);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const resolvedOutput = path.resolve(process.cwd(), this.outputFile);

    // If an external or built-in json reporter already wrote the file, or if we need to cluster
    if (fs.existsSync(resolvedOutput)) {
      try {
        const clusterSummary = clusterResults(resolvedOutput, outDir);
        const dossierSummary = generateDossiers(clusterSummary, outDir);

        if (!this.quiet) {
          process.stdout.write('\n' + dossierSummary.compactIndex + '\n');
        }
        return;
      } catch (e) {
        process.stderr.write(`[pw-lean] Clustering error: ${e.message}\n`);
      }
    }

    if (!this.quiet) {
      process.stdout.write(
        `\n[pw-lean] Suite finished: ${this.total} tests | ${this.passed} passed | ${this.failed} failed | ${this.skipped} skipped\n`
      );
    }
  }
}
