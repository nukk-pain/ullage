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
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => {
    if (request.url === '/slow') return;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('x'.repeat(1_000_001));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(sendJsonRequest(new URL(`${baseUrl}/slow`), 'GET', { body: undefined, headers: {}, timeoutMs: 30 }), /abort|timeout/i);
    await assert.rejects(sendJsonRequest(new URL(`${baseUrl}/large`), 'GET', { body: undefined, headers: {}, timeoutMs: 1_000 }), /response exceeded.*byte limit/i);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
