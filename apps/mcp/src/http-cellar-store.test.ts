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
  const server = await startFakeHTTPServer(() => ({ status: 201, body: serviceWine }));
  try {
    const store = new HttpCellarStore(server.baseUrl);

    const added = await store.addWine({
      name: 'Chablis', producer: 'Raveneau', vintage: 2020, region: 'Burgundy',
      country: 'France', varietal: 'Chardonnay', price: 90, quantity: 2,
      notes: 'mineral', store: 'K&L', purchaseDate: '2026-01-02',
      drinkByDate: '2030-01-02', location: 'A1'
    });

    const request = onlyRequest(server.requests);
    assert.deepEqual(added, mappedWine);
    assert.deepEqual(requestSummary(server.requests), [{ method: 'POST', path: '/wines' }]);
    assert.deepEqual(JSON.parse(request.body), {
      name: 'Chablis',
      producer: 'Raveneau',
      vintage: '2020',
      region: 'Burgundy',
      country: 'France',
      varietal: 'Chardonnay',
      grape_variety: 'Chardonnay',
      price: 90,
      quantity: 2,
      notes: 'mineral',
      store: 'K&L',
      purchase_date: '2026-01-02'
    });
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

    const wine = await store.consumeWine('wine-1', { quantity: 2, rating: 4, notes: 'dinner' });

    assert.deepEqual(wine, { ...mappedWine, quantity: 0, updatedAt: '2026-01-06T00:00:00.000Z' });
    assert.deepEqual(requestSummary(server.requests), [
      { method: 'GET', path: '/wines/wine-1' },
      { method: 'POST', path: '/wines/wine-1/consume' },
      { method: 'POST', path: '/wines/wine-1/consume' }
    ]);
    assert.deepEqual(server.requests.filter((request) => request.method === 'POST').map((request) => JSON.parse(request.body)), [
      { rating: 4, note: 'dinner' },
      { rating: 4, note: 'dinner' }
    ]);
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
    notes: 'wine-level note, not a consumption event note', status: 'Consumed',
    createdAt: '2026-01-07T00:00:00.000Z', updatedAt: '2026-01-07T00:00:00.000Z'
  };
  const olderRow = { ...consumedRow, id: 'consume-2', consumedAt: '2026-01-06T00:00:00.000Z', note: 'older' };
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
        rating: null,
        notes: null,
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
