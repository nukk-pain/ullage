import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawHttpCellarStore } from './openclaw-http-cellar-store.js';
import { requestSummary, serviceWine, startFakeOpenClawServer } from './openclaw-http-cellar-store.test-helper.js';

test('OpenClawHttpCellarStore replays idempotent addWine without duplicate upstream requests', async () => {
  const server = await startFakeOpenClawServer(() => ({ status: 201, body: serviceWine }));
  try {
    const store = new OpenClawHttpCellarStore(server.baseUrl);

    const first = await store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'openclaw-add-1' });
    const replay = await store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'openclaw-add-1' });

    assert.deepEqual(replay, first);
    await assert.rejects(async () => store.addWine({ name: 'Different Chablis', quantity: 1 }, { idempotencyKey: 'openclaw-add-1' }), /different payload/);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'POST', path: '/wines', openClawClient: 'cli' }]);
  } finally {
    await server.close();
  }
});

test('OpenClawHttpCellarStore coalesces concurrent idempotent addWine requests', async () => {
  const server = await startFakeOpenClawServer(() => ({ status: 201, body: serviceWine }));
  try {
    const store = new OpenClawHttpCellarStore(server.baseUrl);

    const [first, replay] = await Promise.all([
      store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'openclaw-add-concurrent-1' }),
      store.addWine({ name: 'Chablis', quantity: 1 }, { idempotencyKey: 'openclaw-add-concurrent-1' })
    ]);

    assert.deepEqual(replay, first);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'POST', path: '/wines', openClawClient: 'cli' }]);
  } finally {
    await server.close();
  }
});

test('OpenClawHttpCellarStore replays idempotent consumeWine without duplicate upstream requests', async () => {
  const consumed = { ...serviceWine, quantity: 0, updatedAt: '2026-01-09T00:00:00.000Z' };
  const responses = [
    { status: 200, body: { ...serviceWine, quantity: 1 } },
    { status: 200, body: { sourceWine: consumed } }
  ];
  const server = await startFakeOpenClawServer(() => responses.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new OpenClawHttpCellarStore(server.baseUrl);

    const first = await store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'openclaw-consume-1' });
    const replay = await store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'openclaw-consume-1' });

    assert.deepEqual(replay, first);
    await assert.rejects(async () => store.consumeWine('wine-1', { quantity: 1, notes: 'different' }, { idempotencyKey: 'openclaw-consume-1' }), /different payload/);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1', openClawClient: 'cli' },
      { method: 'POST', path: '/wines/wine-1/consume', openClawClient: 'cli' }
    ]);
  } finally {
    await server.close();
  }
});

test('OpenClawHttpCellarStore coalesces concurrent idempotent consumeWine requests', async () => {
  const consumed = { ...serviceWine, quantity: 0, updatedAt: '2026-01-10T00:00:00.000Z' };
  const responses = [
    { status: 200, body: { ...serviceWine, quantity: 1 } },
    { status: 200, body: { sourceWine: consumed } }
  ];
  const server = await startFakeOpenClawServer(() => responses.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new OpenClawHttpCellarStore(server.baseUrl);

    const [first, replay] = await Promise.all([
      store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'openclaw-consume-concurrent-1' }),
      store.consumeWine('wine-1', { quantity: 1, notes: 'dinner' }, { idempotencyKey: 'openclaw-consume-concurrent-1' })
    ]);

    assert.deepEqual(replay, first);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1', openClawClient: 'cli' },
      { method: 'POST', path: '/wines/wine-1/consume', openClawClient: 'cli' }
    ]);
  } finally {
    await server.close();
  }
});
