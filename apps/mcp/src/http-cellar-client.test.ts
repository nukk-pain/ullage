import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUllageConfig } from './config.js';
import { sendJsonRequest } from './http-cellar-client.js';
import { createCellarStore } from './store-factory.js';
import { onlyRequest, serviceWine, startFakeHTTPServer } from './http-cellar-store.test-helper.js';

test('HttpCellarStore sends configured headers and keeps JSON request headers', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 201, body: serviceWine }));
  try {
    const config = parseUllageConfig({
      ULLAGE_BACKEND: 'http',
      ULLAGE_HTTP_BASE_URL: server.baseUrl,
      ULLAGE_HTTP_HEADERS: '{"X-Test-Client":"custom-cli","accept":"text/plain","content-type":"text/plain"}'
    });
    const store = createCellarStore(config);

    await store.addWine({ name: 'Chablis', quantity: 1 });

    const request = onlyRequest(server.requests);
    assert.equal(request.headers['x-test-client'], 'custom-cli');
    assert.equal(request.headers.accept, 'application/json');
    assert.equal(request.headers['content-type'], 'application/json');
    await store.close();
  } finally {
    await server.close();
  }
});

test('sendJsonRequest enforces a timeout and caps response bytes', async () => {
  const server = await startFakeHTTPServer(async (request) => {
    if (request.path === '/slow') {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return { status: 200, body: 'ok' };
    }
    return { status: 200, body: 'x'.repeat(1_000_001) };
  });
  try {
    await assert.rejects(sendJsonRequest(new URL(`${server.baseUrl}/slow`), 'GET', { body: undefined, headers: {}, timeoutMs: 30 }), /abort|timeout/i);
    await assert.rejects(sendJsonRequest(new URL(`${server.baseUrl}/large`), 'GET', { body: undefined, headers: {}, timeoutMs: 1_000, maxResponseBytes: 1_000_000 }), /response exceeded.*byte limit/i);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore accepts a 1.15 MB wine list at the default response limit', async () => {
  const wines = Array.from({ length: 180 }, (_, index) => ({
    id: `synthetic-${index}`,
    name: 'Synthetic Chablis',
    quantity: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    producer: 'Synthetic producer',
    vintage: 2020,
    region: 'Burgundy',
    country: 'France',
    varietal: 'Chardonnay',
    price: 100,
    store: 'Synthetic shop',
    purchaseDate: '2026-01-01',
    drinkByDate: '2030-01-01',
    location: 'Synthetic rack',
    notes: 'x'.repeat(6000)
  }));
  const responseBody = { wines };
  assert.equal(Buffer.byteLength(JSON.stringify(responseBody)), 1_148_661);
  const server = await startFakeHTTPServer(() => ({ status: 200, body: responseBody }));
  try {
    const config = parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: server.baseUrl });
    const store = createCellarStore(config);
    assert.equal((await store.listWines()).length, 180);
    await store.close();
  } finally {
    await server.close();
  }
});

test('HttpCellarStore reports the configured response limit when a list is too large', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 200, body: { wines: [{ ...serviceWine, notes: 'x'.repeat(20_000) }], total: 1 } }));
  try {
    const config = parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: server.baseUrl, ULLAGE_HTTP_MAX_RESPONSE_BYTES: '10000' });
    const store = createCellarStore(config);
    await assert.rejects(store.listWines(), /HTTP response exceeded 10000 byte limit/);
    await store.close();
  } finally {
    await server.close();
  }
});
