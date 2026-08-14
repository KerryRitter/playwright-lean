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
| **Output Token Footprint** | Massive (10k–100k tokens of raw traces & stdout per failure) | **Ultra-Lean (< 150 tokens)** with lean summary index table |
| **Failure Diagnosis** | Scrape terminal output file by file | **0-Token Signature Clustering**: Groups 700 failures into ~10 root cause dossiers (`CLUSTER-01`) |
| **Error Trace Delivery** | Injected directly into chat/turn history | **On-Demand Error Dossiers**: Persisted to `.playwright-lean/errors/CLUSTER-XX.md` and read only when needed |
| **Run-to-Run Deltas** | None (manual comparison required) | **Automatic Delta Tracking** (`+fixed / -regressed` vs last execution) |
| **Concurrency & Safety** | Uncoordinated (subagents collide on DB/ports) | **Machine-Wide Run Lease** (`~/.playwright-lean/run.lease`) with automatic stale PID reclamation |
| **Interactive Live Browser** | Requires launching a full separate runner or headed mode | **Fast In-Memory Session + CDP Attach** (`pw-lean connect 9222`, `pw-lean eval`, `pw-lean tabs`) |
| **DOM Tree Compaction** | Full raw accessibility dump | **Noise Stripping & Repeated Sibling Folding** (e.g. 50 table rows folded into 3) |
| **Static Code Quality** | Requires external ESLint plugins | **Instant AST/Regex Auditor** (`pw-lean audit`) scans 3,000 files in < 1s for banned `test.skip` and fixed sleeps |
| **Batch Code Transformations** | Manual search and replace | **Batch AST/Regex Codemod Engine** (`pw-lean codemod`) with dry-run support |
| **MCP Schema Token Tax** | Flat static schema overhead on every turn (~8k tokens) | **Dynamic Tool Group Gating** (`core`, `browser_advanced`, `suite_advanced`) saving > 70% per turn |

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
     │  (< 150 tokens)               │         │  └── snapshots/              │
     └───────────────────────────────┘         └──────────────────────────────┘
                    │                                         │
                    └─────────── On-Demand Read ──────────────┘
                             `pw-lean diagnose CLUSTER-01`
```

1. **The Test Runner outputs a 12-line summary table (< 150 tokens)** containing clickable file links to cluster dossiers (`file://.../.playwright-lean/errors/CLUSTER-01.md#L1`).
2. **AI pairs diagnose issues on-demand** by viewing *only* the specific cluster file (`< 2.5k tokens`) rather than reading the same massive traces on repeat.
3. **Fixed clusters are automatically pruned** on subsequent runs, keeping the workspace completely clean.

---

## 📦 Installation

```bash
cd ~/Workspaces/playwright-lean
npm link
```
This registers the global CLI commands: `playwright-lean`, `pw-lean`, and `playwright-lean-mcp`.

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
# Scan workspace for banned test.skip, fixed sleeps, weakened assertions (< 1s)
pw-lean audit

# Batch transform patterns across all spec files
pw-lean codemod "status\\(\\)\\).toBe\\(200\\)" "status()).toBe(201)" --glob "billing" --dry-run
```

### 3. Live Browser Control & CDP Attach
```bash
# Connect to an existing browser on CDP port 9222
pw-lean connect 9222

# List open browser tabs
pw-lean tabs

# Navigate to a URL
pw-lean navigate "https://example.com"

# Capture a page screenshot (saved to disk, returns local file path)
pw-lean screenshot /tmp/app-state.png

# Evaluate JS in browser DOM context
pw-lean eval "document.title"

# Evaluate in Node.js context with `page` object in scope
pw-lean eval "return await page.locator('button').textContent()" --node
```

---

## 🤖 Model Context Protocol (MCP) Server

Playwright-Lean includes a built-in MCP server for Claude, Gemini, Cursor, Codex, and OpenCode.

### Configuration (`.mcp.json` / AI Agent Settings)
```json
{
  "mcpServers": {
    "playwright-lean": {
      "command": "playwright-lean-mcp"
    }
  }
}
```

### Dynamic Tool Groups (Token Economics)

To eliminate the prompt schema tax, Playwright-Lean starts with **only 8 core tools** and defers the rest. Activate additional groups anytime via `playlite_enable_group`:

| Tool Group | Tools Included | Token Cost | Description |
| :--- | :--- | :---: | :--- |
| **`core`** *(Default)* | `playlite_enable_group`, `playlite_run`, `playlite_diagnose`, `playlite_verify`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type` | **~1.2k tokens** | Essential 8 tools for everyday running & interaction. |
| **`browser_advanced`** *(Deferred)* | `browser_find`, `browser_press_key`, `browser_hover`, `browser_select_option`, `browser_take_screenshot`, `browser_console_messages`, `browser_tabs`, `browser_select_tab`, `browser_eval`, `browser_run_script`, `browser_close` | + ~2k tokens | Advanced browser manipulation & evaluation. |
| **`suite_advanced`** *(Deferred)* | `playlite_cluster`, `playlite_dossier`, `playlite_audit`, `playlite_codemod` | + ~1.5k tokens | Suite refactoring, AST auditing, and batch codemods. |
| **`all`** | All 19 tools | Full schema | Loads the complete tool suite. |

#### Example: Enabling Advanced Tools On-Demand
```json
{
  "name": "playlite_enable_group",
  "arguments": {
    "groups": ["browser_advanced"]
  }
}
```

---

## 🧪 Running Tests

Playwright-Lean includes a comprehensive native test suite covering the lease manager, clustering engine, error dossier generator, static auditor, codemod engine, tool groups, browser session, and MCP JSON-RPC protocol:

```bash
npm test
```
```text
✔ Audit Engine: detects banned test.skip and fixed sleeps (4.49ms)
✔ Browser Session: executes eval expressions and navigates data URLs (299.49ms)
✔ Cluster Engine: groups duplicate failures into root cause clusters (3.72ms)
✔ Codemod Engine: applies regex transformations and dry runs (8.94ms)
✔ Dossier Generator: writes markdown dossiers and compact index (6.86ms)
✔ Tool Groups: starts in core mode and enables groups on demand (2.70ms)
✔ Lease Manager: acquires and releases lease cleanly (2.65ms)
✔ Lease Manager: reclaims stale lease from non-existent PID (1.21ms)
✔ MCP Server: handles JSON-RPC initialize, tools/list, and dynamic tool group activation (580.01ms)
ℹ tests 9 | pass 9 | fail 0 (990ms)
```

---

## 📄 License
MIT © Kerry
