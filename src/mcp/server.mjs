import readline from 'readline';
import { getVisibleTools, handleToolCall } from './tools.mjs';

export async function startMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  function sendResponse(id, result = null, error = null) {
    const payload = {
      jsonrpc: '2.0',
      id,
    };
    if (error) {
      payload.error = error;
    } else {
      payload.result = result;
    }
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  function sendNotification(method, params = null) {
    const payload = {
      jsonrpc: '2.0',
      method,
    };
    if (params) payload.params = params;
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (e) {
      sendResponse(null, null, { code: -32700, message: 'Parse error' });
      return;
    }

    const { id, method, params } = message;

    // Handle JSON-RPC notifications (no id)
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        // Client confirmed init
      }
      return;
    }

    switch (method) {
      case 'initialize': {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'playwright-lean-mcp',
            version: '1.0.0',
          },
        });
        break;
      }

      case 'tools/list': {
        sendResponse(id, {
          tools: getVisibleTools(),
        });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        try {
          const result = await handleToolCall(name, args);
          sendResponse(id, result);
        } catch (e) {
          sendResponse(id, {
            content: [{ type: 'text', text: `Tool error: ${e.message}` }],
            isError: true,
          });
        }
        break;
      }

      default: {
        sendResponse(id, null, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
        break;
      }
    }
  });

  process.stderr.write('[playlite-mcp] Server running on stdio\n');
}
