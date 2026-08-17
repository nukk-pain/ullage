#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ConfigError, createCellarStore, createUllageTools, parseUllageConfig } from '@ullage/mcp';
import { createToolHttpServer } from './server.js';

const DEFAULT_PORT = 8792;

// Prefer a token file so process listings and service definitions never carry the secret.
function readToken(): string {
  const file = process.env.ULLAGE_HTTP_TOKEN_FILE?.trim();
  if (file) {
    try {
      const fromFile = readFileSync(file, 'utf8').trim();
      if (fromFile) return fromFile;
      throw new ConfigError('ULLAGE_HTTP_TOKEN_FILE', `${file} is empty`);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError('ULLAGE_HTTP_TOKEN_FILE', `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const inline = process.env.ULLAGE_HTTP_TOKEN?.trim();
  if (inline) return inline;
  throw new ConfigError('ULLAGE_HTTP_TOKEN', 'ULLAGE_HTTP_TOKEN or ULLAGE_HTTP_TOKEN_FILE is required; refusing to serve the cellar unauthenticated.');
}

try {
  const token = readToken();

  const port = Number(process.env.ULLAGE_HTTP_PORT?.trim() || DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError('ULLAGE_HTTP_PORT', `ULLAGE_HTTP_PORT must be a valid port number, got ${process.env.ULLAGE_HTTP_PORT}`);
  }

  const store = createCellarStore(parseUllageConfig(process.env));
  const server = createToolHttpServer({ tools: createUllageTools(store), token });

  let closed = false;
  function shutdown(code: number): void {
    if (closed) return;
    closed = true;
    server.close(() => {
      void Promise.resolve(store.close()).catch((error: unknown) => {
        process.stderr.write(`[ullage-http] failed to close store: ${error instanceof Error ? error.message : String(error)}\n`);
      });
      process.exit(code);
    });
  }

  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));

  // Loopback only: exposure decisions belong to the reverse proxy in front of this.
  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[ullage-http] listening on http://127.0.0.1:${port}\n`);
  });
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`[ullage-http] ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
