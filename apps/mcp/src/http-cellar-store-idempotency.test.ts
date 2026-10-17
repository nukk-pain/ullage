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
    assert.match(server.requests[0]?.headers['idempotency-key'] ?? '', /^ullage-v1-add-[a-f0-9]{64}$/);
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

test('HttpCellarStore preserves consume progress through 503 then 4xx and replays to zero stock', async () => {
  for (const retryStatus of [409, 400, 422, 429]) {
    let quantity = 2;
    let posts = 0;
    const saved = new Map<string, unknown>();
    const server = await startFakeHTTPServer((request) => {
      if (request.method === 'GET') return { status: 200, body: { ...serviceWine, quantity } };
      posts += 1;
      const key = request.headers['idempotency-key'];
      if (posts === 2) return { status: retryStatus, body: { error: 'not processed' } };
      const replay = saved.get(String(key));
      if (replay !== undefined) return { status: 200, body: replay };
      const result = { sourceWine: { ...serviceWine, quantity: --quantity } };
      saved.set(String(key), result);
      return { status: posts === 1 ? 503 : 200, body: result };
    });
    try {
      const store = new HttpCellarStore(server.baseUrl);
      const input = { quantity: 3 };
      const options = { idempotencyKey: 'consume-uncertain-fourxx' };

      await assert.rejects(store.consumeWine('wine-1', input, options), /HTTP 503/);
      await assert.rejects(store.consumeWine('wine-1', input, options), new RegExp(`HTTP ${retryStatus}`));
      const result = await store.consumeWine('wine-1', input, options);

      assert.equal(result?.quantity, 0);
      assert.equal(quantity, 0);
      assert.equal(server.requests.filter((request) => request.method === 'POST').length, 4);
    } finally {
      await server.close();
    }
  }
});

test('HttpCellarStore does not cache an unresolved consume as complete after POST 404', async () => {
  let quantity = 2;
  let postCount = 0;
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: { ...serviceWine, quantity } };
    postCount += 1;
    if (postCount === 1) {
      quantity -= 1;
      return { status: 503, body: { error: 'response lost after save' } };
    }
    if (postCount === 2) return { status: 404, body: { error: 'not found' } };
    quantity -= 1;
    return { status: 200, body: { sourceWine: { ...serviceWine, quantity } } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const input = { quantity: 1 };
    const options = { idempotencyKey: 'consume-post-404-retry' };
    await assert.rejects(store.consumeWine('wine-1', input, options), /HTTP 503/);
    await assert.rejects(store.consumeWine('wine-1', input, options), /404.*prior consume outcome is unresolved/i);
    const recovered = await store.consumeWine('wine-1', input, options);
    assert.equal(recovered?.quantity, 0);
    assert.equal(quantity, 0);
    assert.equal(postCount, 3);
  } finally {
    await server.close();
  }
});
