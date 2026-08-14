import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';

test('MCP Server: handles JSON-RPC initialize, tools/list, and dynamic tool group activation', async () => {
  const mcpBin = path.resolve(process.cwd(), 'bin/playwright-lean-mcp.mjs');
  const proc = spawn('node', [mcpBin], { stdio: ['pipe', 'pipe', 'pipe'] });

  const responses = [];

  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');

  const waitForResponse = (id) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for msg id ${id}`)), 5000);
      const onData = (data) => {
        const lines = data.toString().split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === id) {
              clearTimeout(timeout);
              proc.stdout.off('data', onData);
              resolve(parsed);
            }
          } catch (e) {}
        }
      };
      proc.stdout.on('data', onData);
    });
  };

  // 1. Initialize
  send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const initRes = await waitForResponse(1);
  assert.equal(initRes.result.serverInfo.name, 'playwright-lean-mcp');

  // 2. Initial tools/list (core group only)
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listRes1 = await waitForResponse(2);
  const toolNames1 = listRes1.result.tools.map((t) => t.name);
  assert.equal(toolNames1.length, 8);
  assert.ok(toolNames1.includes('playlite_run'));
  assert.ok(toolNames1.includes('browser_navigate'));
  assert.equal(toolNames1.includes('browser_eval'), false);

  // 3. Enable browser_advanced
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'playlite_enable_group', arguments: { groups: ['browser_advanced'] } },
  });
  const enableRes = await waitForResponse(3);
  assert.ok(enableRes.result.content[0].text.includes('browser_advanced'));

  // 4. Refreshed tools/list
  send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  const listRes2 = await waitForResponse(4);
  const toolNames2 = listRes2.result.tools.map((t) => t.name);
  assert.equal(toolNames2.length, 19);
  assert.ok(toolNames2.includes('browser_eval'));

  proc.kill();
});
