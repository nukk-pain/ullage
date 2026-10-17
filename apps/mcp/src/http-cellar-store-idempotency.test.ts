import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpCellarStore } from './http-cellar-store.js';
import { requestSummary, serviceWine, startFakeHTTPServer } from './http-cellar-store.test-helper.js';

test('HttpCellarStore replays idempotent addWine without duplicate upstream requests', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 201, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const first = await store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'http-add-1' });
    const replay = await store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'http-add-1' });

    assert.deepEqual(replay, first);
    await assert.rejects(async () => store.addWine({ name: 'Different Chablis', quantity: 1 }, { idempotencyKey: 'http-add-1' }), /different payload/);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'POST', path: '/wines' }]);
    assert.equal(server.requests[0]?.headers['idempotency-key'], 'http-add-1');
  } finally {
    await server.close();
  }
});

test('HttpCellarStore coalesces concurrent idempotent addWine requests', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 201, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const [first, replay] = await Promise.all([
      store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'http-add-concurrent-1' }),
      store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'http-add-concurrent-1' })
    ]);

    assert.deepEqual(replay, first);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'POST', path: '/wines' }]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore replays idempotent consumeWine without duplicate upstream requests', async () => {
  const consumed = { ...serviceWine, quantity: 0, updatedAt: '2026-01-09T00:00:00.000Z' };
  const responses = [
    { status: 200, body: { ...serviceWine, quantity: 1 } },
    { status: 200, body: { sourceWine: consumed } }
  ];
  const server = await startFakeHTTPServer(() => responses.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const first = await store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'http-consume-1' });
    const replay = await store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'http-consume-1' });

    assert.deepEqual(replay, first);
    await assert.rejects(async () => store.consumeWine('wine-1', { quantity: 1, notes: 'different' }, { idempotencyKey: 'http-consume-1' }), /different payload/);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1' },
      { method: 'POST', path: '/wines/wine-1/consume' }
    ]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore coalesces concurrent idempotent consumeWine requests', async () => {
  const consumed = { ...serviceWine, quantity: 0, updatedAt: '2026-01-10T00:00:00.000Z' };
  const responses = [
    { status: 200, body: { ...serviceWine, quantity: 1 } },
    { status: 200, body: { sourceWine: consumed } }
  ];
  const server = await startFakeHTTPServer(() => responses.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const [first, replay] = await Promise.all([
      store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'http-consume-concurrent-1' }),
      store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'http-consume-concurrent-1' })
    ]);

    assert.deepEqual(replay, first);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1' },
      { method: 'POST', path: '/wines/wine-1/consume' }
    ]);
  } finally {
    await server.close();
  }
});
