import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCellarStore, createUllageTools, PartialConsumeError, UnsupportedHttpOperationError, type CellarStore, type McpTool } from '@ullage/mcp';
import { createToolHttpServer } from './server.js';

const TOKEN = 'test-token';

type Harness = {
  readonly url: string;
  readonly store: CellarStore;
  close(): Promise<void>;
};

async function start(tools?: McpTool[]): Promise<Harness> {
  const store = createCellarStore({ backend: 'sqlite', dbPath: ':memory:', appendOnly: false });
  const server = createToolHttpServer({ tools: tools ?? createUllageTools(store), token: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  };
}

function auth(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  };
}

test('health reports ok for an authorized caller', async () => {
  const harness = await start();
  try {
    const response = await fetch(`${harness.url}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', tools: 22 });
  } finally {
    await harness.close();
  }
});

test('tool calls run the same handlers the MCP transport exposes', async () => {
  const harness = await start();
  try {
    const added = await fetch(`${harness.url}/tools/add_wine`, auth({ name: 'Barolo', quantity: 2, idempotencyKey: 'k1' }));
    assert.equal(added.status, 200);
    const wine = (await added.json()).result as { id: string; quantity: number };
    assert.equal(wine.quantity, 2);

    const consumed = await fetch(`${harness.url}/tools/consume_wine`, auth({ id: wine.id, quantity: 1, idempotencyKey: 'k2' }));
    assert.equal(consumed.status, 200);
    assert.equal((await consumed.json()).result.quantity, 1);

    const summary = await fetch(`${harness.url}/tools/cellar_summary`, auth());
    assert.equal((await summary.json()).result.bottle_count, 1);
  } finally {
    await harness.close();
  }
});

test('idempotency keys replay instead of double-writing', async () => {
  const harness = await start();
  try {
    await fetch(`${harness.url}/tools/add_wine`, auth({ name: 'Chablis', quantity: 1, idempotencyKey: 'add-1' }));
    await fetch(`${harness.url}/tools/add_wine`, auth({ name: 'Chablis', quantity: 1, idempotencyKey: 'add-1' }));
    const summary = await fetch(`${harness.url}/tools/cellar_summary`, auth());
    assert.equal((await summary.json()).result.wine_count, 1);
  } finally {
    await harness.close();
  }
});

test('unknown tools are 404 and malformed bodies are 400', async () => {
  const harness = await start();
  try {
    const unknown = await fetch(`${harness.url}/tools/drink_everything`, auth());
    assert.equal(unknown.status, 404);
    assert.match((await unknown.json()).error, /unknown tool/i);

    const malformed = await fetch(`${harness.url}/tools/cellar_summary`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{not json'
    });
    assert.equal(malformed.status, 400);

    const nonObject = await fetch(`${harness.url}/tools/cellar_summary`, auth([1, 2, 3]));
    assert.equal(nonObject.status, 400);
  } finally {
    await harness.close();
  }
});

test('domain rejections surface as 400 with the domain message', async () => {
  const harness = await start();
  try {
    const added = await fetch(`${harness.url}/tools/add_wine`, auth({ name: 'Barbaresco', quantity: 1, idempotencyKey: 'h1' }));
    const wine = (await added.json()).result as { id: string };
    await fetch(`${harness.url}/tools/hold_wine`, auth({ id: wine.id, reason: 'aging', idempotencyKey: 'h2' }));

    const blocked = await fetch(`${harness.url}/tools/consume_wine`, auth({ id: wine.id, quantity: 1, idempotencyKey: 'h3' }));
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /on hold/i);
  } finally {
    await harness.close();
  }
});

test('partial and unsupported errors retain their messages with dedicated statuses', async () => {
  const harness = await start([
    { name: 'partial', description: 'partial', inputSchema: { type: 'object' }, handler: () => { throw new PartialConsumeError(1, 2, new Error('upstream')); } },
    { name: 'unsupported', description: 'unsupported', inputSchema: { type: 'object' }, handler: () => { throw new UnsupportedHttpOperationError('importWines'); } },
    { name: 'invalid', description: 'invalid', inputSchema: { type: 'object' }, handler: () => { throw new Error('bad quantity'); } }
  ]);
  try {
    const partial = await fetch(`${harness.url}/tools/partial`, auth());
    assert.equal(partial.status, 409);
    assert.match((await partial.json()).error, /partially completed/);
    const unsupported = await fetch(`${harness.url}/tools/unsupported`, auth());
    assert.equal(unsupported.status, 501);
    assert.match((await unsupported.json()).error, /unsupported-by-http-backend/);
    const invalid = await fetch(`${harness.url}/tools/invalid`, auth());
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'bad quantity');
  } finally {
    await harness.close();
  }
});

test('unexpected handler failures are 500 without leaking internals', async () => {
  const harness = await start([
    {
      name: 'boom',
      description: 'always fails',
      inputSchema: { type: 'object' },
      handler: () => {
        throw new TypeError('secret internal detail');
      }
    }
  ]);
  try {
    const response = await fetch(`${harness.url}/tools/boom`, auth());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'internal error');
  } finally {
    await harness.close();
  }
});

test('requests without a valid bearer token are rejected', async () => {
  const harness = await start();
  try {
    assert.equal((await fetch(`${harness.url}/health`)).status, 401);
    assert.equal((await fetch(`${harness.url}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const noToken = await fetch(`${harness.url}/tools/cellar_summary`, { method: 'POST', body: '{}' });
    assert.equal(noToken.status, 401);
  } finally {
    await harness.close();
  }
});

test('oversized bodies are rejected before parsing', async () => {
  const harness = await start();
  try {
    const response = await fetch(`${harness.url}/tools/add_wine`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(1_100_000) })
    });
    assert.equal(response.status, 413);
  } finally {
    await harness.close();
  }
});

test('GET on a tool path is rejected', async () => {
  const harness = await start();
  try {
    const response = await fetch(`${harness.url}/tools/cellar_summary`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 405);
  } finally {
    await harness.close();
  }
});
