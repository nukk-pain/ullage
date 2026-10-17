import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpCellarStore } from './http-cellar-store.js';
import { mappedWine, onlyRequest, requestSummary, serviceWine, startFakeHTTPServer } from './http-cellar-store.test-helper.js';

test('HttpCellarStore maps listWines from GET /wines without requiring a client header', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 200, body: { wines: [serviceWine], total: 1 } }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const wines = await store.listWines();

    assert.deepEqual(wines, [mappedWine]);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'GET', path: '/wines' }]);
    const previousClientHeader = ['x-open', 'claw-client'].join('-');
    assert.equal(onlyRequest(server.requests).headers[previousClientHeader], undefined);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore sends snake_case API fields when adding wine with POST /wines', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 201, body: { ...serviceWine, drinkByDate: '2030-01-02', location: 'A1' } }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const added = await store.addWine({
      name: 'Chablis', producer: 'Raveneau', vintage: 2020, region: 'Burgundy',
      country: 'France', varietal: 'Chardonnay', price: 90, quantity: 2,
      notes: 'mineral', store: 'K&L', purchaseDate: '2026-01-02',
      drinkByDate: '2030-01-02', location: 'A1'
    });

    const request = onlyRequest(server.requests);
    assert.deepEqual(added, { ...mappedWine, drinkByDate: '2030-01-02', location: 'A1' });
    assert.deepEqual(requestSummary(server.requests), [{ method: 'POST', path: '/wines' }]);
    assert.deepEqual(JSON.parse(request.body), {
      name: 'Chablis',
      producer: 'Raveneau',
      vintage: 2020,
      region: 'Burgundy',
      country: 'France',
      varietal: 'Chardonnay',
      grape_variety: 'Chardonnay',
      price: 90,
      quantity: 2,
      notes: 'mineral',
      store: 'K&L',
      purchase_date: '2026-01-02',
      drink_by_date: '2030-01-02',
      location: 'A1'
    });
  } finally {
    await server.close();
  }
});

test('HttpCellarStore sends grape_variety for servers that only persist that field', async () => {
  const server = await startFakeHTTPServer((request) => {
    const payload = JSON.parse(request.body) as Record<string, unknown>;
    return { status: 201, body: { ...serviceWine, vintage: payload.vintage, varietal: null, grapeVariety: payload.grape_variety } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const added = await store.addWine({ name: 'Barolo', vintage: 2016, varietal: 'Nebbiolo' });
    const payload = JSON.parse(onlyRequest(server.requests).body) as Record<string, unknown>;
    assert.equal(payload.grape_variety, 'Nebbiolo');
    assert.equal(payload.varietal, 'Nebbiolo');
    assert.equal(payload.vintage, 2016);
    assert.equal(added.varietal, 'Nebbiolo');
  } finally {
    await server.close();
  }
});

test('HttpCellarStore reports when the API does not confirm requested drink-by or location fields', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 201, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);
    await assert.rejects(
      () => store.addWine({ name: 'Chablis', drinkByDate: '2030-01-02', location: 'A1' }),
      /did not confirm saved fields: drinkByDate, location/
    );
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore rejects zero quantity add before making requests', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 500, body: { error: 'unexpected request' } }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    await assert.rejects(async () => store.addWine({ name: 'Zero Chablis', quantity: 0 }), /quantity greater than 0/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore rejects zero quantity consume before making a consume request', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 200, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 0 }), /positive safe integer/);
    assert.deepEqual(server.requests.map((request) => request.method), ['GET']);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore releases pre-POST validation state and retains state after a POST failure', async () => {
  let postStatus = 400;
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: serviceWine };
    if (postStatus === 200) return { status: 200, body: { sourceWine: serviceWine } };
    return { status: postStatus, body: { error: 'rejected' } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 1, consumedAt: 'invalid' }, { idempotencyKey: 'retry-date' }));
    postStatus = 200;
    await store.consumeWine('wine-1', { quantity: 1, consumedAt: '2026-03-14' }, { idempotencyKey: 'retry-date' });
    assert.equal(server.requests.filter((request) => request.method === 'POST').length, 1);

    postStatus = 400;
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'definite-4xx' }));
    assert.equal(store.consumeProgress.has('definite-4xx'), true);
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 2 }, { idempotencyKey: 'definite-4xx' }), /different payload/);
    postStatus = 200;
    await store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'definite-4xx' });
    assert.equal(store.consumeProgress.has('definite-4xx'), false);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore retains consume progress when a POST times out', async () => {
  let postCount = 0;
  const server = await startFakeHTTPServer(async (request) => {
    if (request.method === 'GET') return { status: 200, body: serviceWine };
    postCount += 1;
    if (postCount === 1) await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return { status: 200, body: { sourceWine: { ...serviceWine, quantity: 1 } } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl, {}, 30);
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'timeout-consume' }), /abort|timeout/i);
    assert.equal(store.consumeProgress.has('timeout-consume'), true);
    const result = await store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'timeout-consume' });
    assert.equal(result?.quantity, 1);
    assert.equal(postCount, 2);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore maps getWine from GET /wines/:id', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 200, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const wine = await store.getWine('wine-1');

    assert.deepEqual(wine, mappedWine);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'GET', path: '/wines/wine-1' }]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore consumes quantity two as two POST /wines/:id/consume requests and returns sourceWine', async () => {
  const afterFirst = { ...serviceWine, quantity: 1, updatedAt: '2026-01-05T00:00:00.000Z' };
  const afterSecond = { ...serviceWine, quantity: 0, updatedAt: '2026-01-06T00:00:00.000Z' };
  const responses = [
    { status: 200, body: serviceWine },
    { status: 200, body: { sourceWine: afterFirst } },
    { status: 200, body: { sourceWine: afterSecond } }
  ];
  const server = await startFakeHTTPServer(() => {
    const response = responses.shift();
    return response ?? { status: 500, body: { error: 'unexpected request' } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const wine = await store.consumeWine('wine-1', { quantity: 2, rating: 4.5, notes: 'dinner' });

    assert.deepEqual(wine, { ...mappedWine, quantity: 0, updatedAt: '2026-01-06T00:00:00.000Z' });
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1' },
      { method: 'POST', path: '/wines/wine-1/consume' },
      { method: 'POST', path: '/wines/wine-1/consume' }
    ]);
    assert.deepEqual(server.requests.filter((request) => request.method === 'POST').map((request) => JSON.parse(request.body)), [
      { rating: 4.5, note: 'dinner' },
      { rating: 4.5, note: 'dinner' }
    ]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore reports partial consumption and retries with stable upstream idempotency keys', async () => {
  let quantity = 5;
  let failedSecondRequest = false;
  const processed = new Map<string, unknown>();
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: { ...serviceWine, quantity } };
    const key = request.headers['idempotency-key'];
    const previous = processed.get(key);
    if (previous !== undefined) return { status: 200, body: previous };
    if (key?.endsWith('-2') && !failedSecondRequest) {
      failedSecondRequest = true;
      return { status: 503, body: { error: 'temporary failure' } };
    }
    quantity -= 1;
    const body = { sourceWine: { ...serviceWine, quantity } };
    processed.set(key, body);
    return { status: 200, body };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const input = { quantity: 3 };

    await assert.rejects(
      () => store.consumeWine('wine-1', input, { idempotencyKey: 'consume-retry' }),
      /partially completed \(1\/3 bottles\)/
    );
    const afterRetry = await store.consumeWine('wine-1', input, { idempotencyKey: 'consume-retry' });

    assert.equal(afterRetry?.quantity, 2);
    assert.equal(quantity, 2);
    const headers = server.requests.filter((request) => request.method === 'POST').map((request) => request.headers['idempotency-key']);
    assert.equal(headers.length, 4);
    assert.equal(headers.every((key) => typeof key === 'string'), true);
    assert.equal(headers[1], headers[2]);
    assert.match(headers[0] ?? '', /^ullage-v1-consume-[a-f0-9]{64}-1$/);
    assert.match(headers[3] ?? '', /^ullage-v1-consume-[a-f0-9]{64}-3$/);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore encodes Unicode and long idempotency keys as stable ASCII headers', async () => {
  let quantity = 3;
  let addAttempts = 0;
  let consumeAttempts = 0;
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: { ...serviceWine, quantity } };
    if (request.path === '/wines') {
      addAttempts += 1;
      if (addAttempts === 1) return { status: 503, body: { error: 'retry' } };
      return { status: 200, body: serviceWine };
    }
    consumeAttempts += 1;
    if (consumeAttempts === 1) return { status: 503, body: { error: 'retry' } };
    quantity -= 1;
    return { status: 200, body: { sourceWine: { ...serviceWine, quantity } } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const key = '개봉-한글\n' + 'x'.repeat(400);
    await assert.rejects(() => store.addWine({ name: 'A', quantity: 1 }, { idempotencyKey: key }));
    await store.addWine({ name: 'A', quantity: 1 }, { idempotencyKey: key });
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: `${key}-consume` }));
    await store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: `${key}-consume` });
    const headers = server.requests.filter((request) => request.method === 'POST').map((request) => request.headers['idempotency-key']);
    assert.equal(headers.length, 4);
    assert.equal(headers[0], headers[1]);
    assert.match(headers[0] ?? '', /^ullage-v1-add-[a-f0-9]{64}$/);
    assert.match(headers[0] ?? '', /^[\x00-\x7F]+$/);
    assert.equal(headers[2], headers[3]);
    assert.match(headers[2] ?? '', /^ullage-v1-consume-[a-f0-9]{64}-1$/);
    const asciiStore = new HttpCellarStore(server.baseUrl);
    await asciiStore.addWine({ name: 'ASCII', quantity: 1 }, { idempotencyKey: 'ascii-key' });
    assert.match(server.requests.at(-1)?.headers['idempotency-key'] ?? '', /^ullage-v1-add-[a-f0-9]{64}$/);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore keeps distinct lone surrogate idempotency keys distinct upstream', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 200, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);
    await store.addWine({ name: 'First' }, { idempotencyKey: '\ud800' });
    await store.addWine({ name: 'Second' }, { idempotencyKey: '\ud801' });
    const keys = server.requests.map((request) => request.headers['idempotency-key']);
    assert.notEqual(keys[0], keys[1]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore retries an uncertain first consume to the original clamped target', async () => {
  let quantity = 2;
  let posts = 0;
  const processed = new Map<string, unknown>();
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: { ...serviceWine, quantity } };
    posts += 1;
    const key = request.headers['idempotency-key'] ?? '';
    const previous = processed.get(key);
    if (previous !== undefined) return { status: 200, body: previous };
    quantity -= 1;
    const body = { sourceWine: { ...serviceWine, quantity } };
    processed.set(key, body);
    return posts === 1 ? { status: 503, body: { error: 'uncertain' } } : { status: 200, body };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const input = { quantity: 3 };
    await assert.rejects(() => store.consumeWine('wine-1', input, { idempotencyKey: 'uncertain' }));
    const afterRetry = await store.consumeWine('wine-1', input, { idempotencyKey: 'uncertain' });
    assert.equal(afterRetry?.quantity, 0);
    assert.equal(quantity, 0);
    assert.equal(posts, 3);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore does not cache a 404 after an uncertain first consume', async () => {
  const responses = [
    { status: 200, body: serviceWine },
    { status: 503, body: { error: 'applied but response lost' } },
    { status: 404, body: { error: 'temporarily missing' } },
    { status: 200, body: serviceWine },
    { status: 200, body: { sourceWine: { ...serviceWine, quantity: 1 } } }
  ];
  const server = await startFakeHTTPServer(() => responses.shift() ?? { status: 500, body: {} });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'recover-404' }), /HTTP 503/);
    await assert.rejects(() => store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'recover-404' }), /prior consume outcome is unresolved/);
    const result = await store.consumeWine('wine-1', { quantity: 1 }, { idempotencyKey: 'recover-404' });
    assert.equal(result?.quantity, 1);
    assert.deepEqual(server.requests.map((request) => request.method), ['GET', 'POST', 'GET', 'GET', 'POST']);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore resumes the original clamped consume count after a partial failure', async () => {
  let quantity = 2;
  let failedSecondRequest = false;
  const processed = new Map<string, unknown>();
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: { ...serviceWine, quantity } };
    const key = request.headers['idempotency-key'];
    const previous = processed.get(key ?? '');
    if (previous !== undefined) return { status: 200, body: previous };
    if (key?.endsWith('-2') && !failedSecondRequest) {
      failedSecondRequest = true;
      return { status: 503, body: { error: 'temporary failure' } };
    }
    quantity -= 1;
    const body = { sourceWine: { ...serviceWine, quantity } };
    processed.set(key ?? '', body);
    return { status: 200, body };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const input = { quantity: 3 };

    await assert.rejects(
      () => store.consumeWine('wine-1', input, { idempotencyKey: 'consume-clamped-retry' }),
      /partially completed \(1\/2 bottles\)/
    );
    const afterRetry = await store.consumeWine('wine-1', input, { idempotencyKey: 'consume-clamped-retry' });

    assert.equal(afterRetry?.quantity, 0);
    assert.equal(quantity, 0);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore reports a partial consume when the upstream deletes the wine mid-request', async () => {
  let postCount = 0;
  const server = await startFakeHTTPServer((request) => {
    if (request.method === 'GET') return { status: 200, body: serviceWine };
    postCount += 1;
    if (postCount === 2) return { status: 404, body: { error: 'missing' } };
    return { status: 200, body: { sourceWine: { ...serviceWine, quantity: 1 } } };
  });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    await assert.rejects(
      () => store.consumeWine('wine-1', { quantity: 2 }, { idempotencyKey: 'consume-mid-delete' }),
      /partially completed \(1\/2 bottles\)/
    );
  } finally {
    await server.close();
  }
});

test('HttpCellarStore clamps over-consume requests to available quantity like SQLite', async () => {
  const oneBottle = { ...serviceWine, quantity: 1 };
  const consumed = { ...serviceWine, quantity: 0, updatedAt: '2026-01-08T00:00:00.000Z' };
  const responses = [
    { status: 200, body: oneBottle },
    { status: 200, body: { sourceWine: consumed } }
  ];
  const server = await startFakeHTTPServer(() => responses.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const after = await store.consumeWine('wine-1', { quantity: 3 });
    assert.equal(after?.quantity, 0);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1' },
      { method: 'POST', path: '/wines/wine-1/consume' }
    ]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore maps listConsumptions from paginated consumed wine rows', async () => {
  const consumedRow = {
    id: 'consume-1', wineId: 'wine-1', name: 'Chablis', vintage: '2020',
    producer: 'Raveneau', quantity: 1, consumedAt: '2026-01-07T00:00:00.000Z',
    rating: 4.5, notes: 'event note', status: 'Consumed',
    createdAt: '2026-01-07T00:00:00.000Z', updatedAt: '2026-01-07T00:00:00.000Z'
  };
  const olderRow = { ...consumedRow, id: 'consume-2', consumedAt: '2026-01-06T00:00:00.000Z', rating: null, notes: null };
  const pages = [
    { status: 200, body: { wines: [consumedRow], total: 2 } },
    { status: 200, body: { wines: [olderRow], total: 2 } }
  ];
  const server = await startFakeHTTPServer(() => pages.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const events = await store.listConsumptions();

    assert.deepEqual(events, [
      {
        id: 'consume-1',
        wineId: 'wine-1',
        quantity: 1,
        rating: 4.5,
        notes: 'event note',
        consumedAt: '2026-01-07T00:00:00.000Z'
      },
      {
        id: 'consume-2',
        wineId: 'wine-1',
        quantity: 1,
        rating: null,
        notes: null,
        consumedAt: '2026-01-06T00:00:00.000Z'
      }
    ]);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines?status=Consumed&limit=100&offset=0' },
      { method: 'GET', path: '/wines?status=Consumed&limit=100&offset=1' }
    ]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore continues consumed-history pagination when total is omitted', async () => {
  const row = (id: string) => ({
    id, wineId: 'wine-1', quantity: 1, consumedAt: '2026-01-07T00:00:00.000Z'
  });
  const pages = [
    { status: 200, body: { wines: Array.from({ length: 100 }, (_, index) => row(`consume-${index}`)) } },
    { status: 200, body: { wines: [row('consume-100')] } }
  ];
  const server = await startFakeHTTPServer(() => pages.shift() ?? { status: 500, body: {} });
  try {
    const store = new HttpCellarStore(server.baseUrl);
    const events = await store.listConsumptions();
    assert.equal(events.length, 101);
    assert.deepEqual(server.requests.map((request) => request.path), [
      '/wines?status=Consumed&limit=100&offset=0',
      '/wines?status=Consumed&limit=100&offset=100'
    ]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore stops consumption pagination on an empty page', async () => {
  const consumedRow = {
    id: 'consume-1', wineId: 'wine-1', name: 'Chablis', quantity: 1,
    consumedAt: '2026-01-07T00:00:00.000Z', status: 'Consumed',
    createdAt: '2026-01-07T00:00:00.000Z', updatedAt: '2026-01-07T00:00:00.000Z'
  };
  const pages = [
    { status: 200, body: { wines: [consumedRow], total: 3 } },
    { status: 200, body: { wines: [], total: 3 } }
  ];
  const server = await startFakeHTTPServer(() => pages.shift() ?? { status: 500, body: { error: 'unexpected request' } });
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const events = await store.listConsumptions();

    assert.equal(events.length, 1);
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines?status=Consumed&limit=100&offset=0' },
      { method: 'GET', path: '/wines?status=Consumed&limit=100&offset=1' }
    ]);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore omits upstream error response bodies from thrown errors', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 500, body: { error: 'SECRET stack trace' } }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    await assert.rejects(async () => store.listWines(), (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /HTTP 500/);
      assert.match(error.message, /upstream error response omitted/);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('HttpCellarStore rejects methods unsupported by the HTTP backend before making requests', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 500, body: { error: 'unexpected request' } }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    await assert.rejects(async () => store.exportJson(), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.addNote('wine-1', 'lime', 4), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.listActivity(), /unsupported-by-http-backend/);
    await assert.rejects(
      async () => store.importWines({ idempotencyKey: 'receipt-key-1', source: 'receipt', items: [{ name: 'Chablis' }] }),
      /unsupported-by-http-backend/
    );
    await assert.rejects(async () => store.holdWine('wine-1', { idempotencyKey: 'hold-key-1', reason: 'wait' }), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.releaseHold('wine-1', { idempotencyKey: 'release-key-1' }), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.listHolds(), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.recommendWines({ occasion: 'dinner' }), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.recordTasting({ name: 'Barolo', tastedAt: '2026-07-30' }, { idempotencyKey: 'tasting-key-1' }), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.listTastings(), /unsupported-by-http-backend/);
    await assert.rejects(async () => store.updateConsumption('event-1', { rating: 4 }, { idempotencyKey: 'fix-key-1' }), /unsupported-by-http-backend/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('HttpCellarStore supports listWines query filter and resolveWine over the wines endpoint', async () => {
  const server = await startFakeHTTPServer(() => ({ status: 200, body: { wines: [serviceWine] } }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const searched = await store.listWines('raveneau');
    assert.deepEqual(searched, [mappedWine]);
    assert.deepEqual(await store.listWines('rioja'), []);

    const resolved = await store.resolveWine('chablis');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.status === 'resolved' && resolved.wine.id, mappedWine.id);

    const missing = await store.resolveWine('rioja');
    assert.equal(missing.status, 'none');
  } finally {
    await server.close();
  }
});
