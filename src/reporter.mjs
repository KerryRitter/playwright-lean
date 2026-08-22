import fs from 'fs';
import path from 'path';
import { clusterResults } from './core/cluster.mjs';
import { generateDossiers } from './core/dossier.mjs';

function getTestFile(test) {
  return test.location?.file || test.parent?.location?.file || 'unknown';
}

function getTestTitle(test) {
  return test.title || test.titlePath?.().at(-1) || 'unknown test';
}

function getAssertionResult(test, result) {
  const outcome = typeof test.outcome === 'function' ? test.outcome() : null;
  const unexpected = outcome === 'unexpected';
  const pending = result.status === 'skipped' || outcome === 'skipped';
  const expectedFailure = outcome === 'expected' && (result.status === 'failed' || result.status === 'timedOut');
  const status = unexpected ? 'failed' : pending ? 'pending' : expectedFailure ? 'passed' : result.status === 'passed' ? 'passed' : 'failed';
  const error = result.error || result.errors?.[0];

  return {
    title: getTestTitle(test),
    fullName: getTestTitle(test),
    status,
    failureMessages: status === 'failed'
      ? [error?.stack || error?.message || (result.status === 'passed' ? 'Test was expected to fail, but passed' : 'Test failed')]
      : [],
  };
}

/**
 * Native Playwright reporter that writes a structured, Jest-compatible report,
 * then creates compact on-demand failure dossiers.
 */
export default class PlaywrightLeanReporter {
  constructor(options = {}) {
    this.outputDir = options.outputDir || '.playwright-lean';
    this.outputFile = options.outputFile || path.join(this.outputDir, 'results.json');
    this.quiet = options.quiet ?? false;
    this.total = 0;
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.resultsByTest = new Map();
  }

  onBegin(config, suite) {
    this.total = suite.allTests().length;
    if (!this.quiet) {
      process.stderr.write(`[pw-lean] Executing ${this.total} tests with Playwright-Lean...\n`);
    }
  }

  onTestEnd(test, result) {
    if (result.status === 'passed') this.passed++;
    else if (result.status === 'skipped') this.skipped++;
    else this.failed++;

    this.resultsByTest.set(test, { file: getTestFile(test), assertion: getAssertionResult(test, result) });
  }

  async onEnd() {
    const outDir = path.resolve(process.cwd(), this.outputDir);
    fs.mkdirSync(outDir, { recursive: true });

    const grouped = new Map();
    for (const { file, assertion } of this.resultsByTest.values()) {
      if (!grouped.has(file)) grouped.set(file, []);
      grouped.get(file).push(assertion);
    }
    const report = {
      testResults: Array.from(grouped, ([name, assertionResults]) => ({ name, assertionResults })),
    };
    const resolvedOutput = path.resolve(process.cwd(), this.outputFile);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, JSON.stringify(report, null, 2), 'utf8');

    try {
      const clusterSummary = clusterResults(resolvedOutput, outDir);
      const dossierSummary = generateDossiers(clusterSummary, outDir);
      if (!this.quiet) process.stdout.write(`\n${dossierSummary.compactIndex}\n`);
    } catch (err) {
      process.stderr.write(`[pw-lean] Clustering error: ${err.message}\n`);
    }
  }
}
