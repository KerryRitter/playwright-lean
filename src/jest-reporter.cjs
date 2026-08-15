const fs = require('fs');
const path = require('path');

class JestLeanReporter {
  constructor(globalConfig, options = {}) {
    this._globalConfig = globalConfig;
    this._options = options;
  }

  async onRunComplete(contexts, results) {
    const outDir = path.resolve(process.cwd(), this._options.outputDir || '.playwright-lean');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const jsonPath = path.join(outDir, 'jest-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

    try {
      const { clusterResults } = await import('./core/cluster.mjs');
      const { generateDossiers } = await import('./core/dossier.mjs');
      const clusterSummary = clusterResults(jsonPath, outDir);
      const dossierSummary = generateDossiers(clusterSummary, outDir);
      process.stdout.write('\n' + dossierSummary.compactIndex + '\n');
    } catch (e) {
      process.stderr.write(`[pw-lean] Jest clustering error: ${e.message}\n`);
    }
  }
}

module.exports = JestLeanReporter;
module.exports.default = JestLeanReporter;
