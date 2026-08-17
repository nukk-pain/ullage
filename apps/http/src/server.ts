// Loopback HTTP transport over the same tool registry the MCP server exposes.
// Browsers and non-MCP clients get identical semantics because the handlers are shared —
// there is no second implementation of cellar rules here.
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpTool } from '@ullage/mcp';

const MAX_BODY_BYTES = 1_000_000;

export type ToolHttpServerOptions = {
  readonly tools: readonly McpTool[];
  readonly token: string;
};

class BodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createToolHttpServer(options: ToolHttpServerOptions): Server {
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));

  return createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log(error);
      send(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorized(req, options.token)) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    const path = (req.url ?? '/').split('?')[0];

    if (path === '/health') {
      if (req.method !== 'GET') {
        send(res, 405, { error: 'method not allowed' });
        return;
      }
      send(res, 200, { status: 'ok', tools: toolsByName.size });
      return;
    }

    if (!path.startsWith('/tools/')) {
      send(res, 404, { error: 'not found' });
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }

    const name = decodeURIComponent(path.slice('/tools/'.length));
    const tool = toolsByName.get(name);
    if (!tool) {
      send(res, 404, { error: `unknown tool ${name}` });
      return;
    }

    let args: Record<string, unknown>;
    try {
      args = await readArgs(req);
    } catch (error) {
      if (error instanceof BodyError) {
        send(res, error.status, { error: error.message });
        return;
      }
      throw error;
    }

    try {
      const result = await tool.handler(args);
      send(res, 200, { result: result ?? null });
    } catch (error) {
      // Domain rejections (hold in place, append-only violation, unknown id) are caller
      // errors and carry a message worth showing; anything else stays opaque.
      if (error instanceof Error && error.name === 'Error') {
        send(res, 400, { error: error.message });
        return;
      }
      log(error);
      send(res, 500, { error: 'internal error' });
    }
  }
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function readArgs(req: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BodyError(413, 'request body too large');

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BodyError(413, 'request body too large');
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BodyError(400, 'request body must be JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BodyError(400, 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function log(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[ullage-http] ${message}\n`);
}
