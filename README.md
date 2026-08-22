# Playwright-Lean ⚡

> **Token-optimized CLI & Model Context Protocol (MCP) server for Playwright.**  
> Built to make running, diagnosing, auditing, and repairing massive Playwright test suites (1,000+ tests) ultra-fast, deterministic, and token-efficient for developers and AI coding agents.

---

## 🎯 Why Playwright-Lean?

Running large Playwright test suites alongside AI pair programmers (Claude, Gemini, Cursor, Codex, OpenCode) typically results in **catastrophic token drain, hallucination loops, and process thrashing**:

1. **The 100k Token Dump Trap**: When standard Playwright fails, dumping terminal walls, raw traces, and 10,000-line DOM accessibility trees burns 100,000+ tokens on every single turn.
2. **The Pareto Fallacy in Test Suites**: 700 failing tests are almost *never* 700 unique bugs. They are ~10–15 root cause POM or fixture regressions. AI agents naively attempt to edit 700 individual test files in isolation.
3. **Machine Process Collisions**: Concurrent subagents running test runners collide on database records, ports, and browser instances, causing false timeouts and SIGTERM 143 exits.
4. **Per-Turn Schema Tax**: Exposing 20+ tool schemas to an LLM charges ~6,000–8,000 tokens of schema overhead on *every single conversational turn*, even when doing nothing.

**Playwright-Lean fixes all four systematically.**

---

## ⚔️ Playwright-Lean vs Playwright

| Capability | Standard Playwright CLI (`npx playwright`) | Playwright-Lean (`pw-lean` / MCP) |
| :--- | :--- | :--- |
| **Output Token Footprint** | Massive (10k–100k tokens of raw traces & stdout per failure) | **Bounded summary** with the first 10 clusters and on-disk dossiers |
| **Failure Diagnosis** | Scrape terminal output file by file | **Signature clustering**: Persists root-cause dossiers (`CLUSTER-01`) for on-demand inspection |
| **Error Trace Delivery** | Injected directly into chat/turn history | **On-Demand Error Dossiers**: Persisted to `.playwright-lean/errors/CLUSTER-XX.md` and read only when needed |
| **Run-to-Run Deltas** | None (manual comparison required) | **Automatic Delta Tracking** (`+fixed / -regressed` vs last execution) |
| **Concurrency & Safety** | Uncoordinated (subagents collide on DB/ports) | **Machine-Wide Run Lease** (`~/.playwright-lean/run.lease`) with automatic stale PID reclamation |
| **Interactive Live Browser** | Requires launching a full separate runner or headed mode | **Fast In-Memory Session + CDP Attach** (`pw-lean connect 9222`, `pw-lean eval`, `pw-lean tabs`) |
| **DOM Tree Compaction** | Full raw accessibility dump | **Noise Stripping & Repeated Sibling Folding** (e.g. 50 table rows folded into 3) |
| **Static Code Quality** | Requires external ESLint plugins | **Focused regex auditor** (`pw-lean audit`) for banned `test.skip` and fixed sleeps in test files |
| **Batch Code Transformations** | Manual search and replace | **Safe regex codemod preview** (`pw-lean codemod`) with explicit `--apply` |
| **MCP Schema Exposure** | All tool schemas available at once | **Dynamic tool groups** (`core`, `browser_advanced`, `suite_advanced`) load advanced schemas on demand |

---

## 🏛️ Core Architecture: Lean Index + On-Demand Depth

Playwright-Lean strictly adheres to the principle: **Lean results by default, complete on-demand depth when needed.**

```
                                  RUNNER EXECUTION
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
         TERMINAL / AGENT CONTEXT                      DISK PERSISTENCE
     ┌───────────────────────────────┐         ┌──────────────────────────────┐
     │  ### 📊 Test Run Summary      │         │ .playwright-lean/            │
     │  Total: 777 | Failed: 777     │         │  ├── results.json            │
     │  Clusters: 4                  │ ──────> │  ├── cache/run-state.json    │
     │  | Cluster    | Failures |    │         │  ├── errors/                 │
     │  | CLUSTER-01 | 42       |    │         │  │   ├── CLUSTER-01.md       │
     │  | CLUSTER-02 | 18       |    │         │  │   └── CLUSTER-02.md       │
     │  (first 10 clusters)          │         │  └── snapshots/              │
     └───────────────────────────────┘         └──────────────────────────────┘
                    │                                         │
                    └─────────── On-Demand Read ──────────────┘
                             `pw-lean diagnose CLUSTER-01`
```

1. **The Test Runner outputs a bounded summary table** with the first 10 clusters and clickable links to full dossiers (`file://.../.playwright-lean/errors/CLUSTER-01.md#L1`).
2. **AI pairs diagnose issues on-demand** by viewing only the specific cluster file, rather than reading the same massive traces on repeat.
3. **Fixed clusters are automatically pruned** on subsequent runs, keeping the workspace completely clean.

---

## 📦 Installation

Install Playwright-Lean in the test project that will produce the reports. Node.js 20 or later is required:

```bash
npm install --save-dev playwright-lean
```

Use `npx pw-lean` from that project. For local development of this repository instead, run `npm install` and then `npm link`; this registers the global `playwright-lean`, `pw-lean`, and `playwright-lean-mcp` commands.

## 🚀 Quick start

For an existing Playwright suite, run the suite through Playwright-Lean:

```bash
npx pw-lean run
```

The command writes the runner JSON and a compact failure index under `.playwright-lean/`. When a failure cluster is present, inspect only the relevant dossier:

```bash
npx pw-lean diagnose CLUSTER-01
```

After fixing it, re-run just the affected specs:

```bash
npx pw-lean verify CLUSTER-01
```

`pw-lean run` always writes a fresh JSON report, even when the project has its own `playwright.config.*`. It deliberately uses Playwright's JSON and line reporters for that run so report generation is deterministic.

`.playwright-lean/` is generated local state: it contains results, clusters, dossiers, snapshots, and the previous-run cache. It is intentionally ignored by Git.

## 🧾 Jest and Vitest reports

Playwright-Lean clusters structured runner results, not terminal text. Keep the report file on disk until `pw-lean` has generated the dossiers. The workflow differs slightly by runner:

| Runner | Set up | Report file | Lean action |
| :--- | :--- | :--- | :--- |
| Playwright | Run `npx pw-lean run` | `.playwright-lean/results.json` | Automatic |
| Jest | Register the custom reporter below | `.playwright-lean/jest-results.json` | Automatic at the end of Jest's run |
| Vitest | Enable Vitest's `json` reporter below | `.playwright-lean/vitest-results.json` | Run `npx pw-lean dossier <report>` after Vitest finishes |

The generated cluster index and dossiers always live in `.playwright-lean/errors/`. A newer processed report replaces the current index and updates the run-to-run delta cache, so use separate worktrees or archive the directory if you need to retain independent historical runs.

### Jest

Jest can invoke the bundled reporter directly. Add it **in addition to** Jest's default reporter so developers retain normal terminal output:

```js
// jest.config.cjs
module.exports = {
  reporters: [
    'default',
    ['playwright-lean/jest-reporter', { outputDir: '.playwright-lean' }],
  ],
};
```

Then run Jest normally:

```bash
npx jest
```

The reporter receives Jest's in-memory results, writes `jest-results.json`, and immediately clusters failures and creates dossiers. Jest's `--json` flag is not required for this integration.

### Native Playwright reporter

For teams that prefer a reporter in `playwright.config.*` instead of calling `pw-lean run`, register the bundled reporter by itself. It writes a structured report and dossiers without relying on reporter ordering:

```ts
// playwright.config.ts
import { defineConfig } from 'playwright/test';

export default defineConfig({
  reporter: [['playwright-lean/reporter', { outputDir: '.playwright-lean' }]],
});
```

### Vitest

Vitest's built-in JSON reporter emits a Jest-compatible `testResults` document, which Playwright-Lean can consume. Configure Vitest to retain the normal terminal reporter and write JSON to a stable path:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [
      'default',
      ['json', { outputFile: '.playwright-lean/vitest-results.json' }],
    ],
  },
});
```

Run the tests, then process the JSON file:

```bash
npx vitest run
npx pw-lean dossier .playwright-lean/vitest-results.json
npx pw-lean diagnose CLUSTER-01
```

Vitest returns a non-zero exit code when tests fail, which is expected. Run the `dossier` command even after that failure; do not connect the two commands with `&&`, or the dossier step will be skipped. The JSON file is required—Vitest's default or minimal terminal output cannot be clustered reliably.

---

## 🛠️ CLI Reference

### 1. Test Suite Execution & Diagnostics
```bash
# Run tests quietly under machine lease
pw-lean run
pw-lean run src/tests/crm/
pw-lean run --project=chromium --workers=1

# Group failures into root cause clusters (0 tokens)
pw-lean cluster [results.json]

# Refresh error dossiers and compute deltas
pw-lean dossier

# View minimal AI repair payload for a specific cluster
pw-lean diagnose CLUSTER-01

# Re-run ONLY the specs affected by a specific cluster or file
pw-lean verify CLUSTER-01
pw-lean verify src/tests/crm/leads.spec.ts
```

### 2. Static Quality Audit & Batch Codemods
```bash
# Scan test files for banned test.skip, fixed sleeps, and weakened assertions
pw-lean audit

# Preview a regex transform across test files; add --apply to write changes
pw-lean codemod "status\\(\\)\\).toBe\\(200\\)" "status()).toBe(201)" --glob "billing"
pw-lean codemod "status\\(\\)\\).toBe\\(200\\)" "status()).toBe(201)" --glob "billing" --apply
```

### 3. Live Browser Control & CDP Attach
```bash
# Check an existing browser's CDP endpoint
pw-lean connect 9222

# Each command is a separate process; pass --cdp to target the same browser
pw-lean tabs --cdp 9222

# Navigate an existing browser
pw-lean navigate "https://example.com" --cdp 9222

# Capture a page screenshot under .playwright-lean/screenshots/
pw-lean screenshot app-state.png --cdp 9222

# Evaluate JS in the page DOM context
pw-lean eval "document.title" --cdp 9222
```

---

## 🤖 Model Context Protocol (MCP) Server

Playwright-Lean includes a built-in MCP server for Claude, Gemini, Cursor, Codex, and OpenCode.

### Configuration (`.mcp.json` / AI Agent Settings)
```json
{
  "mcpServers": {
    "playwright-lean": {
      "command": "npx",
      "args": ["--no-install", "playwright-lean-mcp"]
    }
  }
}
```

### Dynamic Tool Groups (Token Economics)

To eliminate the prompt schema tax, Playwright-Lean starts with **only 8 core tools** and defers the rest. Activate additional groups anytime via `playwright-lean_enable_group`:

| Tool Group | Tools Included | Token Cost | Description |
| :--- | :--- | :---: | :--- |
| **`core`** *(Default)* | `playwright-lean_enable_group`, `playwright-lean_run`, `playwright-lean_diagnose`, `playwright-lean_verify`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type` | **~1.2k tokens** | Essential 8 tools for everyday running & interaction. |
| **`browser_advanced`** *(Deferred)* | `browser_find`, `browser_press_key`, `browser_hover`, `browser_select_option`, `browser_take_screenshot`, `browser_console_messages`, `browser_tabs`, `browser_select_tab`, `browser_eval`, `browser_close` | + ~2k tokens | Advanced browser manipulation and page-context evaluation. |
| **`suite_advanced`** *(Deferred)* | `playwright-lean_cluster`, `playwright-lean_dossier`, `playwright-lean_audit`, `playwright-lean_codemod` | + ~1.5k tokens | Suite refactoring, AST auditing, and batch codemods. |
| **`all`** | All 22 tools | Full schema | Loads the complete tool suite. |

The MCP codemod tool only previews changes by default. To allow an MCP client to write test files, start the server with `PW_LEAN_ALLOW_MCP_MUTATIONS=1` and pass `apply: true`; the CLI requires `--apply` instead.

#### Example: Enabling Advanced Tools On-Demand
```json
{
  "name": "playwright-lean_enable_group",
  "arguments": {
    "groups": ["browser_advanced"]
  }
}
```

---

## 🧪 Running Tests

Playwright-Lean includes a native test suite covering the lease manager, real configured Playwright runs, clustering, dossier generation, auditing, safe codemods, browser controls, and MCP protocol boundaries:

```bash
npm test
```
The test count is intentionally not documented here; use the command output as the source of truth.

---

## 📤 Publishing to npm

This repository publishes from GitHub Actions only after a GitHub release is marked **published**. The workflow checks out the release tag, installs dependencies and Chromium, runs the full test suite, and publishes the public package with provenance. It uses npm trusted publishing (OIDC), so it does not require an npm token in GitHub secrets.

Before the first release, authenticate to npm with the account that should own `playwright-lean`, then create the trust relationship:

```bash
npm login
npm install --global npm@^11.5.1
npm trust github playwright-lean \
  --repo KerryRitter/playwright-lean \
  --file publish.yml \
  --allow-publish
```

Trusted publishing requires npm 11.5.1+ and Node 22.14+ for this setup. If npm requires the package to exist before it can create the trust relationship, perform the one-time initial publish from this checked-out, verified release instead:

```bash
npx playwright install chromium
npm publish --provenance --access public
```

Then rerun the `npm trust github` command. For every later version, update `version` in `package.json`, commit and tag it as `v<version>`, push the tag, and create a matching GitHub Release. The release activates `.github/workflows/publish.yml`.

Keep `repository.url` pointed at this public repository: npm uses the exact URL when establishing provenance. After the trusted publisher has succeeded once, consider enabling npm's **Require two-factor authentication and disallow tokens** publishing policy for the package.

---

## 📄 License
MIT © Kerry
