#!/usr/bin/env node
import { startMcpServer } from '../src/mcp/server.mjs';

try {
  await startMcpServer();
} catch (err) {
  process.stderr.write(`playwright-lean-mcp: ${err.message}\n`);
  process.exitCode = 1;
}
