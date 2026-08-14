import { runPlaywright } from '../core/runner.mjs';
import { clusterResults } from '../core/cluster.mjs';
import { generateDossiers } from '../core/dossier.mjs';
import { getDiagnostic } from '../core/diagnose.mjs';
import { verifyTarget } from '../core/verify.mjs';
import { auditCodebase } from '../core/audit.mjs';
import { runCodemod } from '../core/codemod.mjs';
import { runScript } from '../core/script.mjs';
import { session } from '../browser/session.mjs';
import { groupManager, TOOL_GROUPS } from './groups.mjs';

export const ALL_MCP_TOOLS = [
  // --- DYNAMIC GROUP CONTROLLER ---
  {
    name: 'playlite_enable_group',
    description: 'Dynamically enable deferred tool groups (e.g. "browser_advanced", "suite_advanced", or "all") on-demand to save ~70% token overhead on routine turns.',
    inputSchema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['browser_advanced', 'suite_advanced', 'all'],
          },
          description: 'Names of tool groups to activate on-demand.',
        },
      },
      required: ['groups'],
    },
  },

  // --- CORE SUITE TOOLS ---
  {
    name: 'playlite_run',
    description: 'Execute Playwright tests quietly with machine lease, outputting a lean run summary index (< 150 tokens) and generating on-demand error dossiers in .playwright-lean/errors/.',
    inputSchema: {
      type: 'object',
      properties: {
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional spec files or directory paths to run (e.g. ["src/tests/crm/"]).',
        },
        project: { type: 'string', description: 'Optional Playwright project name (e.g. "chromium").' },
        workers: { type: 'number', description: 'Number of worker threads (default 1).' },
        config: { type: 'string', description: 'Optional Playwright config file path.' },
      },
    },
  },
  {
    name: 'playlite_diagnose',
    description: 'Get the exact minimal repair dossier for a specific failure cluster on demand (< 2.5k tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'string', description: 'Cluster ID to diagnose (e.g. "CLUSTER-01").' },
      },
      required: ['clusterId'],
    },
  },
  {
    name: 'playlite_verify',
    description: 'Re-run only the specs affected by a specific cluster or file to verify a fix immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Cluster ID (e.g. "CLUSTER-01") or spec file path to verify.' },
      },
      required: ['target'],
    },
  },

  // --- CORE BROWSER TOOLS ---
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL and return the page title and initial accessibility snapshot with element refs.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute URL to navigate to (e.g. "http://localhost:3000/auth/login").' },
        waitUntil: { type: 'string', enum: ['domcontentloaded', 'load', 'networkidle'], description: 'When to consider navigation succeeded.' },
        timeout: { type: 'number', description: 'Navigation timeout in milliseconds.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Capture a token-compacted accessibility tree with element ref IDs (e.g. e1, e2) for targeted interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'Maximum depth of the accessibility tree (default 4).' },
        target: { type: 'string', description: 'Optional CSS selector or ref to scope the snapshot.' },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by its snapshot ref ID (e.g. "e12") or CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref ID (e.g. "e12") or selector to click.' },
        force: { type: 'boolean', description: 'Whether to bypass actionability checks.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_type',
    description: 'Fill or type text into an input element by its snapshot ref ID or selector.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref ID (e.g. "e4") or input selector.' },
        text: { type: 'string', description: 'The text value to enter.' },
        clear: { type: 'boolean', description: 'Whether to clear existing text before typing (default true).' },
      },
      required: ['target', 'text'],
    },
  },

  // --- ADVANCED BROWSER TOOLS ---
  {
    name: 'browser_find',
    description: 'Cheaply search the current page for elements matching text or role without dumping the full accessibility tree.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text or accessible name to search for.' },
        role: { type: 'string', description: 'Optional accessibility role (e.g. "button", "link", "textbox").' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key (e.g. "Enter", "Tab", "Escape", "ArrowDown").',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Name of the key to press.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element by its ref ID or selector.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref ID or selector to hover.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select one or more options in a dropdown select element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref ID or select selector.' },
        values: { type: 'array', items: { type: 'string' }, description: 'Values or labels to select.' },
      },
      required: ['target', 'values'],
    },
  },
  {
    name: 'browser_take_screenshot',
    description: 'Capture a page screenshot and save to disk (.playwright-lean/screenshots/), returning the file path to avoid base64 token bloat.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Optional custom filename.' },
        fullPage: { type: 'boolean', description: 'Whether to capture the entire scrollable page.' },
      },
    },
  },
  {
    name: 'browser_console_messages',
    description: 'Get captured browser console messages and JavaScript runtime errors.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['error', 'warning', 'info', 'log'], description: 'Optional log level filter.' },
      },
    },
  },
  {
    name: 'browser_tabs',
    description: 'List all open tabs in the browser context.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_select_tab',
    description: 'Switch active page to a specific tab by title substring or 1-based index.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Tab title substring or 1-based numeric index (e.g. "1" or "Dashboard").' },
      },
      required: ['filter'],
    },
  },
  {
    name: 'browser_eval',
    description: 'Evaluate JavaScript in the page DOM context (default) or Node context with --node.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code expression to evaluate.' },
        nodeContext: { type: 'boolean', description: 'If true, evaluates in Node.js context with `page`, `context`, `browser` in scope.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_run_script',
    description: 'Run an ad-hoc debug/test script against the live browser with `page` and helpers in scope.',
    inputSchema: {
      type: 'object',
      properties: {
        scriptPathOrCode: { type: 'string', description: 'Script file path or code string to execute.' },
      },
      required: ['scriptPathOrCode'],
    },
  },
  {
    name: 'browser_close',
    description: 'Close the active browser session and release browser resources.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // --- ADVANCED SUITE TOOLS ---
  {
    name: 'playlite_cluster',
    description: 'Parse Playwright results.json and group test failures into root cause clusters by failure signature.',
    inputSchema: {
      type: 'object',
      properties: {
        jsonPath: { type: 'string', description: 'Path to results.json (default ".playwright-lean/results.json").' },
      },
    },
  },
  {
    name: 'playlite_dossier',
    description: 'Generate on-demand markdown error dossiers (.playwright-lean/errors/CLUSTER-XX.md) and compute run-to-run deltas (+fixed / -regressed).',
    inputSchema: {
      type: 'object',
      properties: {
        jsonPath: { type: 'string', description: 'Path to results.json (default ".playwright-lean/results.json").' },
      },
    },
  },
  {
    name: 'playlite_audit',
    description: 'Run static AST/regex audit across test files for anti-patterns (test.skip, fixed sleeps, weakened assertions).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to scan (default current workspace).' },
      },
    },
  },
  {
    name: 'playlite_codemod',
    description: 'Apply batch regex/AST pattern transformations across test specs.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Regular expression pattern to find.' },
        replace: { type: 'string', description: 'Replacement string.' },
        glob: { type: 'string', description: 'Optional file filter (e.g. "billing").' },
        dryRun: { type: 'boolean', description: 'If true, simulates changes without modifying files on disk.' },
      },
      required: ['find', 'replace'],
    },
  },
];

export function getVisibleTools() {
  const hidden = groupManager.getHiddenGroupsInfo();
  return ALL_MCP_TOOLS.filter((t) => groupManager.isToolEnabled(t.name)).map((t) => {
    if (t.name === 'playlite_enable_group') {
      const summary = hidden.length > 0
        ? ` Currently deferred: ${hidden.map((h) => `${h.group} (${h.count} tools)`).join(', ')}.`
        : ' All tool groups currently enabled.';
      return {
        ...t,
        description: t.description + summary,
      };
    }
    return t;
  });
}

export async function handleToolCall(name, args = {}) {
  switch (name) {
    case 'playlite_enable_group': {
      const { groups = [] } = args;
      const newlyEnabled = groupManager.enable(groups);
      const active = Array.from(groupManager.enabledGroups);
      return {
        content: [
          {
            type: 'text',
            text: `Tool groups updated.\nNewly enabled: ${newlyEnabled.join(', ') || 'none (already active)'}\nActive groups: ${active.join(', ')}\nCall 'tools/list' to see refreshed schemas.`,
          },
        ],
      };
    }

    // Browser tools
    case 'browser_navigate': {
      const res = await session.navigate(args.url, args);
      return {
        content: [
          {
            type: 'text',
            text: `Navigated to ${res.url} (Status: ${res.status}, Title: "${res.title}")\n\n${res.snapshot}`,
          },
        ],
      };
    }

    case 'browser_snapshot': {
      const res = await session.snapshot(args);
      return {
        content: [
          {
            type: 'text',
            text: `URL: ${res.url} | Title: "${res.title}"\n\n${res.tree}`,
          },
        ],
      };
    }

    case 'browser_find': {
      const res = await session.find(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      };
    }

    case 'browser_click': {
      const res = await session.click(args.target, args);
      return {
        content: [{ type: 'text', text: `Clicked ${res.target} -> URL: ${res.url}` }],
      };
    }

    case 'browser_type': {
      const res = await session.type(args.target, args.text, args);
      return {
        content: [{ type: 'text', text: `Typed into ${res.target}` }],
      };
    }

    case 'browser_press_key': {
      const res = await session.pressKey(args.key, args);
      return {
        content: [{ type: 'text', text: `Pressed key: ${res.key}` }],
      };
    }

    case 'browser_hover': {
      const res = await session.hover(args.target, args);
      return {
        content: [{ type: 'text', text: `Hovered over ${res.target}` }],
      };
    }

    case 'browser_select_option': {
      const res = await session.selectOption(args.target, args.values, args);
      return {
        content: [{ type: 'text', text: `Selected option(s) in ${res.target}` }],
      };
    }

    case 'browser_take_screenshot': {
      const res = await session.takeScreenshot(args);
      return {
        content: [{ type: 'text', text: `Screenshot saved to: ${res.path}` }],
      };
    }

    case 'browser_console_messages': {
      const logs = session.getConsoleMessages(args.level);
      return {
        content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }],
      };
    }

    case 'browser_tabs': {
      const tabs = await session.tabs();
      return {
        content: [{ type: 'text', text: JSON.stringify(tabs, null, 2) }],
      };
    }

    case 'browser_select_tab': {
      const res = await session.selectTab(args.filter);
      return {
        content: [{ type: 'text', text: `Switched to Tab ${res.index}: "${res.title}" (${res.url})` }],
      };
    }

    case 'browser_eval': {
      const res = await session.eval(args.code, args);
      const formatted = typeof res === 'object' ? JSON.stringify(res, null, 2) : String(res);
      return {
        content: [{ type: 'text', text: formatted }],
      };
    }

    case 'browser_run_script': {
      const res = await runScript(args.scriptPathOrCode, args);
      const text = res.success
        ? `✅ Script executed successfully in ${res.durationMs}ms.\nResult: ${JSON.stringify(res.result, null, 2)}`
        : `❌ Script execution failed: ${res.error}\nStack: ${res.stack}`;
      return {
        content: [{ type: 'text', text }],
        isError: !res.success,
      };
    }

    case 'browser_close': {
      await session.close();
      return {
        content: [{ type: 'text', text: 'Browser session closed.' }],
      };
    }

    // Suite tools
    case 'playlite_run': {
      const { patterns = [], project, workers = 1, config = 'playwright.config.ts' } = args;
      const result = await runPlaywright({
        patterns,
        project,
        workers,
        config,
        quiet: true,
      });

      const text = result.dossier
        ? result.dossier.indexMarkdown
        : `Execution finished with exit code ${result.exitCode} (${Math.round(result.durationMs / 1000)}s).`;

      return {
        content: [{ type: 'text', text }],
        isError: result.exitCode !== 0 && (!result.dossier || result.dossier.failed > 0),
      };
    }

    case 'playlite_cluster': {
      const { jsonPath = '.playwright-lean/results.json' } = args;
      try {
        const summary = clusterResults(jsonPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }

    case 'playlite_dossier': {
      const { jsonPath = '.playwright-lean/results.json' } = args;
      const res = generateDossiers(jsonPath);
      return {
        content: [{ type: 'text', text: res.indexMarkdown }],
      };
    }

    case 'playlite_diagnose': {
      const { clusterId } = args;
      try {
        const diag = getDiagnostic(clusterId);
        return {
          content: [{ type: 'text', text: diag.content }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }

    case 'playlite_verify': {
      const { target } = args;
      try {
        const res = await verifyTarget(target, { quiet: true });
        const summary = res.passed
          ? `✅ Verification SUCCESS: All specs for ${res.label} passed!`
          : `❌ Verification FAILED: Specs for ${res.label} failed (Exit code ${res.exitCode}).\n\n${res.dossier?.indexMarkdown || ''}`;
        return {
          content: [{ type: 'text', text: summary }],
          isError: !res.passed,
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }

    case 'playlite_audit': {
      const { path: targetDir = process.cwd() } = args;
      const result = auditCodebase(targetDir);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    case 'playlite_codemod': {
      const { find, replace, glob = '', dryRun = false } = args;
      const res = runCodemod(find, replace, { dryRun, glob });
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}
