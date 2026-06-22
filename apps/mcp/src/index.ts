#!/usr/bin/env node
import { ConfigError, parseUllageConfig } from './config.js';
import { runMcpServer } from './mcp.js';
import { createCellarStore } from './store-factory.js';
import { createUllageTools } from './tools.js';

try {
  const config = parseUllageConfig(process.env);
  const store = createCellarStore(config);
  let closed = false;

  function closeStore(): void {
    if (closed) return;
    closed = true;
    void Promise.resolve(store.close()).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[ullage-mcp] failed to close store: ${message}\n`);
    });
  }

  process.once('exit', closeStore);
  process.once('SIGINT', () => {
    closeStore();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    closeStore();
    process.exit(143);
  });
  process.stdin.once('end', closeStore);

  runMcpServer({
    name: 'ullage',
    version: '0.1.0',
    tools: createUllageTools(store)
  });
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`[ullage-mcp] ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
