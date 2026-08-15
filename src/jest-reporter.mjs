import fs from 'fs';
import path from 'path';
import { clusterResults } from './core/cluster.mjs';
import { generateDossiers } from './core/dossier.mjs';

/**
 * JestLeanReporter
 * 
 * Native Jest reporter for backend/API unit and integration test suites:
 * 1. Collects Jest testResults
 * 2. Writes .playwright-lean/jest-results.json
 * 3. Automatically clusters errors by implementation stack frames
 * 4. Writes on-demand dossiers to .playwright-lean/errors/
 * 5. Emits ultra-lean summary table
 */
export default class JestLeanReporter {
  constructor(globalConfig, options = {}) {
    this._globalConfig = globalConfig;
    this._options = options;
  }

  onRunComplete(contexts, results) {
    const outDir = path.resolve(process.cwd(), this._options.outputDir || '.playwright-lean');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const jsonPath = path.join(outDir, 'jest-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

    try {
      const clusterSummary = clusterResults(jsonPath, outDir);
      const dossierSummary = generateDossiers(clusterSummary, outDir);
      process.stdout.write('\n' + dossierSummary.compactIndex + '\n');
    } catch (e) {
      process.stderr.write(`[pw-lean] Jest clustering error: ${e.message}\n`);
    }
  }
}
