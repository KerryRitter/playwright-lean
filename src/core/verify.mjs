import fs from 'fs';
import path from 'path';
import { runPlaywright } from './runner.mjs';
import { isTestFile } from './test-files.mjs';

export async function verifyTarget(target, options = {}) {
  let patterns = [];
  let targetLabel = target;

  if (target.startsWith('CLUSTER-')) {
    const dossierPath = path.resolve(process.cwd(), `.playwright-lean/errors/${target}.md`);
    if (!fs.existsSync(dossierPath)) {
      throw new Error(`Dossier ${target} not found. Run 'playwright-lean dossier' first.`);
    }

    const content = fs.readFileSync(dossierPath, 'utf8');
    const matches = content.match(/- `([^`]+)`/g) || [];
    const files = new Set();

    for (const m of matches) {
      const filePath = m.replace(/^- `/, '').replace(/`$/, '');
      if (isTestFile(filePath)) {
        files.add(filePath);
      }
    }

    patterns = Array.from(files);
    targetLabel = `${target} (${patterns.length} spec files)`;
  } else {
    patterns = [target];
  }

  if (patterns.length === 0) {
    throw new Error(`No test files found to verify for target: ${target}`);
  }

  if (!options.quiet) {
    process.stderr.write(`[playwright-lean] Verifying ${targetLabel}...\n`);
  }

  const result = await runPlaywright({
    patterns,
    project: options.project,
    workers: options.workers || 1,
    config: options.config,
    quiet: options.quiet,
  });

  return {
    target,
    label: targetLabel,
    patterns,
    exitCode: result.exitCode,
    passed: result.exitCode === 0,
    dossier: result.dossier,
  };
}
