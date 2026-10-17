import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUllageConfig } from './config.js';
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
