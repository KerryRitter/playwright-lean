import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const CLI_BIN = path.resolve(process.cwd(), 'bin/playwright-lean.mjs');
const MCP_BIN = path.resolve(process.cwd(), 'bin/playwright-lean-mcp.mjs');

function runCli(args = [], options = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf8',
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

test('E2E CLI: --help returns usage guide and exit code 0', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('playwright-lean (pw-lean)'));
  assert.ok(res.stdout.includes('Commands:'));
  assert.ok(res.stdout.includes('cluster'));
  assert.ok(res.stdout.includes('diagnose'));
  assert.ok(res.stdout.includes('audit'));
});

test('E2E CLI: cluster command parses results JSON and outputs JSON summary', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-cluster-'));
  const resultsJson = path.join(tmpDir, 'results.json');

  const fakeResults = {
    suites: [
      {
        title: 'Billing Tests',
        file: 'billing.spec.ts',
        specs: [
          {
            title: 'should process refund',
            file: 'billing.spec.ts',
            tests: [
              {
                status: 'unexpected',
                results: [
                  {
                    status: 'failed',
                    error: {
                      message: 'Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\nLocator: getByText("Refund Success")',
                      stack: 'Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n    at BillingModal.submit (src/objects/BillingModal.ts:50:12)\n    at billing.spec.ts:25:5',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(resultsJson, JSON.stringify(fakeResults, null, 2));

  const res = runCli(['cluster', resultsJson], { cwd: tmpDir });
  assert.equal(res.status, 0);

  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.failed, 1);
  assert.equal(parsed.clusterCount, 1);
  assert.equal(parsed.clusters[0].id, 'CLUSTER-01');
  assert.equal(parsed.clusters[0].category, 'TIMEOUT_EXPECT');
  assert.ok(parsed.clusters[0].primaryLocation.includes('BillingModal.ts:50'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('E2E CLI: dossier command creates .playwright-lean/errors/ and outputs INDEX.md table', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-dossier-'));
  const resultsJson = path.join(tmpDir, 'results.json');

  const fakeResults = {
    suites: [
      {
        title: 'Auth Tests',
        file: 'auth.spec.ts',
        specs: [
          {
            title: 'should fail on invalid token',
            file: 'auth.spec.ts',
            tests: [
              {
                status: 'unexpected',
                results: [
                  {
                    status: 'failed',
                    error: {
                      message: 'Error: 401 Unauthorized\n    at AuthService.login (src/auth.ts:22:9)\n    at auth.spec.ts:15:5',
                      stack: 'Error: 401 Unauthorized\n    at AuthService.login (src/auth.ts:22:9)\n    at auth.spec.ts:15:5',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(resultsJson, JSON.stringify(fakeResults, null, 2));

  const res = runCli(['dossier', resultsJson], { cwd: tmpDir });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('### 📊 Test Run Summary'));
  assert.ok(res.stdout.includes('CLUSTER-01'));
  assert.ok(res.stdout.includes('auth.ts:22'));

  assert.ok(fs.existsSync(path.join(tmpDir, '.playwright-lean/errors/CLUSTER-01.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, '.playwright-lean/errors/INDEX.md')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('E2E CLI: diagnose command outputs discrete cluster markdown dossier', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-diag-'));
  const errorsDir = path.join(tmpDir, '.playwright-lean', 'errors');
  fs.mkdirSync(errorsDir, { recursive: true });

  const dossierContent = '# Failure Dossier: CLUSTER-01\n**Category**: `AUTH_FAILURE`\n**Root Stack Frame**: `src/auth.ts:22`\n';
  fs.writeFileSync(path.join(errorsDir, 'CLUSTER-01.md'), dossierContent);

  const res = runCli(['diagnose', 'CLUSTER-01'], { cwd: tmpDir });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('# Failure Dossier: CLUSTER-01'));
  assert.ok(res.stdout.includes('AUTH_FAILURE'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('E2E CLI: audit command scans directory and reports issues', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-audit-'));
  const badSpec = path.join(tmpDir, 'bad.spec.ts');
  fs.writeFileSync(badSpec, 'test.skip("skipped test", () => {});\nawait page.waitForTimeout(500);');

  const res = runCli(['audit', tmpDir]);
  assert.equal(res.status, 1); // 1 because of ERROR severity (BANNED_TEST_SKIP)
  assert.ok(res.stdout.includes('1 ERRORS'));
  assert.ok(res.stdout.includes('1 WARNINGS'));
  assert.ok(res.stdout.includes('BANNED_TEST_SKIP'));
  assert.ok(res.stdout.includes('UNSAFE_FIXED_SLEEP'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('E2E CLI: codemod command performs batch refactoring', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-codemod-'));
  const sampleFile = path.join(tmpDir, 'sample.spec.ts');
  fs.writeFileSync(sampleFile, 'await page.waitForTimeout(1000);');

  // Test dry-run
  const dryRes = runCli(['codemod', 'page\\.waitForTimeout\\(\\d+\\)', 'page.waitForLoadState("networkidle")', '--dry-run'], { cwd: tmpDir });
  assert.equal(dryRes.status, 0);
  const dryParsed = JSON.parse(dryRes.stdout);
  assert.equal(dryParsed.filesModified, 1);
  assert.equal(dryParsed.dryRun, true);
  assert.equal(fs.readFileSync(sampleFile, 'utf8'), 'await page.waitForTimeout(1000);');

  // Test real execution
  const realRes = runCli(['codemod', 'page\\.waitForTimeout\\(\\d+\\)', 'page.waitForLoadState("networkidle")'], { cwd: tmpDir });
  assert.equal(realRes.status, 0);
  assert.equal(fs.readFileSync(sampleFile, 'utf8'), 'await page.waitForLoadState("networkidle");');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('E2E CLI: eval command evaluates expressions in live browser and node contexts', () => {
  // Browser DOM eval
  const domRes = runCli(['eval', '100 + 45']);
  assert.equal(domRes.status, 0);
  assert.equal(domRes.stdout.trim(), '145');

  // Node context eval
  const nodeRes = runCli(['eval', '--node', '2 * 3 * 4']);
  assert.equal(nodeRes.status, 0);
  assert.equal(nodeRes.stdout.trim(), '24');
});

test('E2E CLI: navigate, screenshot, and tabs commands operate cleanly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-nav-'));
  const screenshotPath = path.join(tmpDir, 'test-shot.png');
  const dataUrl = 'data:text/html,<html><head><title>E2E Page</title></head><body><h1>Playwright Lean E2E</h1></body></html>';

  const navRes = runCli(['navigate', dataUrl]);
  assert.equal(navRes.status, 0);

  const shotRes = runCli(['screenshot', screenshotPath]);
  assert.equal(shotRes.status, 0);
  assert.ok(fs.existsSync(screenshotPath));
  assert.ok(fs.statSync(screenshotPath).size > 0);

  const tabsRes = runCli(['tabs', '--json']);
  assert.equal(tabsRes.status, 0);
  const tabs = JSON.parse(tabsRes.stdout);
  assert.ok(Array.isArray(tabs));
  assert.ok(tabs.length >= 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('E2E MCP: stdio server handles JSON-RPC initialization and tool discovery', async () => {
  const proc = spawnSync(process.execPath, [MCP_BIN], {
    input: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'e2e-test-runner', version: '1.0.0' },
      },
    }) + '\n' + JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n',
    encoding: 'utf8',
  });

  assert.equal(proc.status, 0);
  const lines = proc.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{'));
  assert.ok(lines.length >= 2);

  const initResponse = JSON.parse(lines[0]);
  assert.equal(initResponse.id, 1);
  assert.equal(initResponse.result.serverInfo.name, 'playwright-lean-mcp');

  const toolsResponse = JSON.parse(lines[1]);
  assert.equal(toolsResponse.id, 2);
  const toolNames = toolsResponse.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('playlite_enable_group'));
  assert.ok(toolNames.includes('browser_navigate'));
  assert.ok(toolNames.includes('browser_snapshot'));
  assert.ok(toolNames.includes('browser_click'));
});
