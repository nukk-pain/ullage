// Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited).
// Dependency-free to avoid coupling to a specific SDK version; follows the MCP spec methods
// that OpenClaw/Hermes and other clients use: initialize, tools/list, tools/call, ping.
// IMPORTANT: stdout carries only protocol messages — all logging goes to stderr.

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type McpServerOptions = {
  name: string;
  version: string;
  tools: McpTool[];
};

const SUPPORTED_PROTOCOL = '2025-06-18';

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export function runMcpServer(options: McpServerOptions): void {
  const toolsByName = new Map(options.tools.map((t) => [t.name, t]));

  function send(message: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  function reply(id: JsonRpcMessage['id'], result: unknown): void {
    send({ jsonrpc: '2.0', id, result });
  }

  function fail(id: JsonRpcMessage['id'], code: number, message: string): void {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async function dispatch(msg: JsonRpcMessage): Promise<void> {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        const requested = typeof params?.protocolVersion === 'string' ? (params.protocolVersion as string) : SUPPORTED_PROTOCOL;
        reply(id, {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name, version: options.version }
        });
        return;
      }
      case 'notifications/initialized':
      case 'initialized':
        return; // notification, no response
      case 'ping':
        if (!isNotification) reply(id, {});
        return;
      case 'tools/list': {
        reply(id, {
          tools: options.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
        });
        return;
      }
      case 'tools/call': {
        const name = params?.name as string | undefined;
        const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};
        const tool = name ? toolsByName.get(name) : undefined;
        if (!tool) {
          fail(id, -32602, `Unknown tool: ${name}`);
          return;
        }
        try {
          const out = await tool.handler(args);
          const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
          reply(id, { content: [{ type: 'text', text }] });
        } catch (error) {
          reply(id, {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true
          });
        }
        return;
      }
      default:
        if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
    }
  }

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let parsed: JsonRpcMessage | JsonRpcMessage[];
      try {
        parsed = JSON.parse(line);
      } catch {
        process.stderr.write(`[ullage-mcp] dropped non-JSON line\n`);
        continue;
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      for (const m of messages) void dispatch(m);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write(`[ullage-mcp] ${options.name} ready (${options.tools.length} tools)\n`);
}
