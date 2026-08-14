import path from 'path';
import fs from 'fs';
import { runPlaywright } from './core/runner.mjs';
import { clusterResults } from './core/cluster.mjs';
import { generateDossiers } from './core/dossier.mjs';
import { getDiagnostic } from './core/diagnose.mjs';
import { verifyTarget } from './core/verify.mjs';
import { auditCodebase } from './core/audit.mjs';
import { runCodemod } from './core/codemod.mjs';
import { startMcpServer } from './mcp/server.mjs';
import { session } from './browser/session.mjs';

export async function cli(args = []) {
  const command = args[0] || '--help';
  const rest = args.slice(1);

  switch (command) {
    case 'run': {
      let project = null;
      let workers = 1;
      let config = 'playwright.config.ts';
      let quiet = true;
      let json = false;
      const patterns = [];

      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg.startsWith('--project=')) {
          project = arg.split('=')[1];
        } else if (arg === '--project') {
          project = rest[++i];
        } else if (arg.startsWith('--workers=')) {
          workers = parseInt(arg.split('=')[1], 10);
        } else if (arg === '--workers') {
          workers = parseInt(rest[++i], 10);
        } else if (arg.startsWith('--config=')) {
          config = arg.split('=')[1];
        } else if (arg === '--verbose') {
          quiet = false;
        } else if (arg === '--json') {
          json = true;
        } else if (!arg.startsWith('-')) {
          patterns.push(arg);
        }
      }

      const result = await runPlaywright({
        patterns,
        project,
        workers,
        config,
        quiet,
      });

      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.dossier) {
        console.log(result.dossier.indexMarkdown);
      } else {
        console.log(`Finished with exit code ${result.exitCode} (${Math.round(result.durationMs / 1000)}s)`);
      }

      return result.exitCode;
    }

    case 'cluster': {
      const jsonPath = rest[0] || (fs.existsSync('.playwright-lean/results.json') ? '.playwright-lean/results.json' : 'test-results/results.json');
      const summary = clusterResults(jsonPath);
      console.log(JSON.stringify(summary, null, 2));
      return 0;
    }

    case 'dossier': {
      const jsonPath = rest[0] || (fs.existsSync('.playwright-lean/results.json') ? '.playwright-lean/results.json' : 'test-results/results.json');
      const res = generateDossiers(jsonPath);
      console.log(res.indexMarkdown);
      return 0;
    }

    case 'diagnose': {
      const clusterId = rest[0];
      if (!clusterId) {
        process.stderr.write('Error: Cluster ID required (e.g. playwright-lean diagnose CLUSTER-01)\n');
        return 1;
      }
      const diag = getDiagnostic(clusterId);
      console.log(diag.content);
      return 0;
    }

    case 'verify': {
      const target = rest[0];
      if (!target) {
        process.stderr.write('Error: Target required (e.g. playwright-lean verify CLUSTER-01 or verify path/to/file.spec.ts)\n');
        return 1;
      }
      const res = await verifyTarget(target, { quiet: false });
      if (res.passed) {
        console.log(`\n✅ Verification SUCCESS: All specs for ${res.label} passed!`);
        return 0;
      } else {
        console.log(`\n❌ Verification FAILED: Exit code ${res.exitCode}`);
        return 1;
      }
    }

    case 'audit': {
      const targetDir = rest[0] || process.cwd();
      const result = auditCodebase(targetDir);

      if (result.totalIssues === 0) {
        console.log(`✅ Audit Clean: Scanned ${result.scannedFiles} files, 0 issues found.`);
        return 0;
      }

      console.log(`Scanned ${result.scannedFiles} files: ${result.errors} ERRORS | ${result.warnings} WARNINGS\n`);
      const table = result.issues.slice(0, 20).map((i) => ({
        Severity: i.severity,
        Rule: i.rule,
        Location: `${i.file}:${i.line}`,
        Snippet: i.snippet,
      }));
      console.table(table);

      if (result.issues.length > 20) {
        console.log(`... and ${result.issues.length - 20} more violations.`);
      }

      return result.errors > 0 ? 1 : 0;
    }

    case 'codemod': {
      const find = rest[0];
      const replace = rest[1];
      let glob = '';
      let dryRun = false;

      for (let i = 2; i < rest.length; i++) {
        if (rest[i] === '--dry-run') dryRun = true;
        if (rest[i] === '--glob' && rest[i + 1]) glob = rest[++i];
      }

      if (!find || replace === undefined) {
        process.stderr.write('Error: Usage: playwright-lean codemod <findRegex> <replaceStr> [--glob <pattern>] [--dry-run]\n');
        return 1;
      }

      const res = runCodemod(find, replace, { dryRun, glob });
      console.log(JSON.stringify(res, null, 2));
      return 0;
    }

    case 'connect': {
      const port = parseInt(rest[0] || '9222', 10);
      try {
        const res = await session.connectOverCDP(port);
        process.stderr.write(`Connected to browser on port ${port} (${res.tabCount} tab${res.tabCount === 1 ? '' : 's'})\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`Connection failed: ${err.message}\n`);
        return 1;
      }
    }

    case 'tabs': {
      try {
        const tabList = await session.tabs();
        if (rest.includes('--json')) {
          console.log(JSON.stringify(tabList, null, 2));
        } else {
          for (const t of tabList) {
            console.log(`  ${t.index}: ${t.title || '(untitled)'} (${t.url})${t.active ? ' [active]' : ''}`);
          }
        }
        return 0;
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        return 1;
      }
    }

    case 'navigate': {
      const url = rest[0];
      if (!url) {
        process.stderr.write('Error: URL required (e.g. playwright-lean navigate "https://example.com")\n');
        return 1;
      }
      try {
        const res = await session.navigate(url);
        process.stderr.write(`Navigated to ${res.url}\n`);
        console.log(res.url);
        return 0;
      } catch (err) {
        process.stderr.write(`Navigation failed: ${err.message}\n`);
        return 1;
      }
    }

    case 'screenshot': {
      const destPath = rest[0];
      try {
        const res = await session.takeScreenshot({ filename: destPath, fullPage: rest.includes('--full') });
        process.stderr.write(`Screenshot saved to ${res.path}\n`);
        console.log(res.path);
        return 0;
      } catch (err) {
        process.stderr.write(`Screenshot failed: ${err.message}\n`);
        return 1;
      }
    }

    case 'eval': {
      const code = rest[0];
      if (!code) {
        process.stderr.write('Error: Code expression required\n');
        return 1;
      }
      try {
        const nodeContext = rest.includes('--node');
        const res = await session.eval(code, { nodeContext });
        if (typeof res === 'object') {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(res);
        }
        return 0;
      } catch (err) {
        process.stderr.write(`Eval error: ${err.message}\n`);
        return 1;
      }
    }

    case 'mcp': {
      await startMcpServer();
      return 0;
    }

    case '--help':
    case '-h':
    case 'help':
    default: {
      console.log(`playwright-lean (pw-lean) - Token-optimized CLI and MCP server for Playwright

Usage:
  playwright-lean <command> [options]
  pw-lean <command> [options]

Commands:
  run [patterns...]        Execute Playwright tests quietly with machine lease, 
                           outputting a lean run summary index (< 150 tokens) and
                           generating on-demand error dossiers in .playwright-lean/errors/.
                           Options: --project, --workers, --config, --verbose, --json

  cluster [results.json]   Group test failures into root cause clusters by signature.

  dossier [results.json]   Generate on-demand markdown dossiers (.playwright-lean/errors/CLUSTER-XX.md)
                           and compute run-to-run deltas (+fixed / -regressed).

  diagnose <cluster-id>    View the exact minimal repair dossier for a specific cluster.

  verify <target>          Re-run only the specs affected by a specific cluster or file.

  audit [dir]              Static AST/regex scanner for anti-patterns (test.skip, fixed sleeps).

  codemod <find> <replace> Batch regex/AST pattern transformer across all test specs.
                           Options: --glob <pattern>, --dry-run

  connect [port]           Connect to an existing Chromium browser over CDP (default: 9222).

  tabs [--json]            List open browser tabs.

  navigate <url>           Navigate the browser to a URL.

  screenshot [path]        Capture a page screenshot to file.

  eval "<code>" [--node]   Evaluate JS in browser context (or Node.js with --node).

  mcp                      Start the Playwright-Lean Model Context Protocol (MCP) server on stdio.

Examples:
  pw-lean run
  pw-lean run src/tests/crm/
  pw-lean diagnose CLUSTER-01
  pw-lean verify CLUSTER-01
  pw-lean audit
  pw-lean eval "document.title"
`);
      return 0;
    }
  }
}
