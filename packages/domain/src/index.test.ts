import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTastings,
  filterWines,
  forbiddenAppendOnlyFields,
  normalizeAddWine,
  normalizeBatchImport,
  normalizeIdempotencyKey,
  normalizeRecordTasting,
  normalizeTastingQuery,
  optionalDate,
  optionalInt,
  requireName,
  resolveWineByName,
  type Tasting,
  type Wine
} from './index.js';

test('normalizeAddWine validates and normalizes fields', () => {
  const w = normalizeAddWine({ name: '  Barolo  ', producer: 'Conterno', vintage: '2016', quantity: 3, price: '89.5' });
  assert.equal(w.name, 'Barolo');
  assert.equal(w.producer, 'Conterno');
  assert.equal(w.vintage, 2016);
  assert.equal(w.quantity, 3);
  assert.equal(w.price, 89.5);
  assert.equal(w.rating, null);
});

test('quantity defaults to 1 and empty optionals become null', () => {
  const w = normalizeAddWine({ name: 'Chablis' });
  assert.equal(w.quantity, 1);
  assert.equal(w.producer, null);
  assert.equal(w.vintage, null);
});

test('requireName rejects blank names', () => {
  assert.throws(() => requireName('   '), /name is required/);
  assert.throws(() => requireName(undefined), /name is required/);
});

test('optionalDate normalizes to YYYY-MM-DD or null', () => {
  assert.equal(optionalDate('2026-03-14 15:42'), '2026-03-14');
  assert.equal(optionalDate('not a date'), null);
  assert.equal(optionalInt('2019'), 2019);
});

test('domain idempotency and batch import contracts normalize receipt rows and reject unsafe inputs', () => {
  assert.equal(normalizeIdempotencyKey('  receipt-chat-1  '), 'receipt-chat-1');
  assert.throws(() => normalizeIdempotencyKey('   '), /idempotencyKey is required/);

  const batch = normalizeBatchImport({
    idempotencyKey: 'receipt-chat-1',
    source: 'receipt',
    sourceId: 'receipt-2026-06-21',
    items: [
      { name: '  Barolo  ', producer: 'Conterno', vintage: '2016', quantity: '2', itemKey: 'line-1' },
      { name: 'Chablis', quantity: 1, itemKey: 'line-2' }
    ]
  });
  assert.equal(batch.source, 'receipt');
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[0]?.name, 'Barolo');
  assert.equal(batch.items[0]?.itemKey, 'line-1');

  assert.throws(
    () => normalizeBatchImport({ idempotencyKey: 'receipt-chat-2', source: 'receipt', items: [{ kind: 'non_wine', name: 'corkscrew' }] }),
    /non-wine receipt row/
  );
  assert.throws(
    () => normalizeBatchImport({
      idempotencyKey: 'receipt-chat-3',
      source: 'label_photo',
      items: [{ name: 'Barolo', itemKey: 'dup' }, { name: 'Brunello', itemKey: 'dup' }]
    }),
    /duplicate itemKey/
  );

  assert.deepEqual(forbiddenAppendOnlyFields({ name: 'New name', quantity: 2, region: 'Loire' }), ['name', 'region']);
});

function wineFixture(overrides: Partial<Wine>): Wine {
  return {
    id: 'wine-x', name: 'Wine', producer: null, vintage: null, region: null, country: null,
    varietal: null, price: null, quantity: 1, rating: null, notes: null, store: null,
    purchaseDate: null, drinkByDate: null, location: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', hold: null,
    ...overrides
  };
}

test('normalizeRecordTasting requires name and tastedAt and normalizes optionals', () => {
  const tasting = normalizeRecordTasting({
    name: '  Brunello di Montalcino  ', tastedAt: '2026-07-30', venue: 'Osteria', vintage: '2019',
    rating: '4.5', foodPairing: ['bistecca', '', 42 as unknown]
  });
  assert.equal(tasting.wineName, 'Brunello di Montalcino');
  assert.equal(tasting.tastedAt, '2026-07-30');
  assert.equal(tasting.venue, 'Osteria');
  assert.equal(tasting.vintage, 2019);
  assert.equal(tasting.rating, 4.5);
  assert.deepEqual(tasting.foodPairing, ['bistecca']);

  assert.throws(() => normalizeRecordTasting({ name: 'Barolo', tastedAt: 'not a date' }), /tastedAt is required/);
  assert.throws(() => normalizeRecordTasting({ name: '  ', tastedAt: '2026-07-30' }), /name is required/);
});

test('normalizeTastingQuery validates source and defaults limit/offset', () => {
  const query = normalizeTastingQuery({ source: 'external', minRating: '4', limit: 10 });
  assert.equal(query.source, 'external');
  assert.equal(query.minRating, 4);
  assert.equal(query.limit, 10);
  assert.equal(query.offset, 0);
  assert.equal(normalizeTastingQuery().source, null);
  assert.throws(() => normalizeTastingQuery({ source: 'bar' }), /source must be/);
});

test('filterTastings applies source, rating, venue, and text filters over the unified timeline', () => {
  const tastings: Tasting[] = [
    {
      id: 't-1', source: 'external', wineId: null, wineName: 'Barolo', vintage: 2016, producer: null,
      region: 'Piedmont', venue: 'Osteria Roma', foodPairing: null, rating: 4.5, price: null,
      currency: null, notes: 'great', imageUrl: null, tastedAt: '2026-07-30', createdAt: '2026-07-30T12:00:00.000Z'
    },
    {
      id: 't-2', source: 'cellar', wineId: 'wine-1', wineName: 'Chablis', vintage: 2020, producer: 'Raveneau',
      region: 'Burgundy', venue: null, foodPairing: null, rating: 3, price: null,
      currency: null, notes: null, imageUrl: null, tastedAt: '2026-07-29', createdAt: '2026-07-29T12:00:00.000Z'
    }
  ];
  assert.deepEqual(filterTastings(tastings, normalizeTastingQuery({ source: 'external' })).map((t) => t.id), ['t-1']);
  assert.deepEqual(filterTastings(tastings, normalizeTastingQuery({ minRating: 4 })).map((t) => t.id), ['t-1']);
  assert.deepEqual(filterTastings(tastings, normalizeTastingQuery({ venue: 'osteria' })).map((t) => t.id), ['t-1']);
  assert.deepEqual(filterTastings(tastings, normalizeTastingQuery({ query: 'raveneau' })).map((t) => t.id), ['t-2']);
  assert.deepEqual(filterTastings(tastings, normalizeTastingQuery({ limit: 1, offset: 1 })).map((t) => t.id), ['t-2']);
});

test('filterWines matches name, producer, region, varietal, and country case-insensitively', () => {
  const wines = [
    wineFixture({ id: 'w-1', name: 'Barolo', producer: 'Conterno', region: 'Piedmont', varietal: 'Nebbiolo', country: 'Italy' }),
    wineFixture({ id: 'w-2', name: 'Chablis', producer: 'Raveneau', region: 'Burgundy', varietal: 'Chardonnay', country: 'France' })
  ];
  assert.deepEqual(filterWines(wines, 'nebbiolo').map((w) => w.id), ['w-1']);
  assert.deepEqual(filterWines(wines, 'FRANCE').map((w) => w.id), ['w-2']);
  assert.equal(filterWines(wines, '').length, 2);
  assert.equal(filterWines(wines, 'rioja').length, 0);
});

test('resolveWineByName resolves exact, surfaces ambiguity, and splits a trailing vintage', () => {
  const wines = [
    wineFixture({ id: 'w-1', name: 'Barolo', vintage: 2016, quantity: 0 }),
    wineFixture({ id: 'w-2', name: 'Barolo', vintage: 2019, quantity: 1 }),
    wineFixture({ id: 'w-3', name: 'Chablis', vintage: 2020, quantity: 1 })
  ];

  const exact = resolveWineByName(wines, 'chablis');
  assert.equal(exact.status, 'resolved');
  assert.equal(exact.status === 'resolved' && exact.wine.id, 'w-3');

  const ambiguous = resolveWineByName(wines, 'Barolo');
  assert.equal(ambiguous.status, 'ambiguous');
  // In-stock bottle ranks ahead of the consumed-out one.
  assert.deepEqual(ambiguous.status === 'ambiguous' && ambiguous.candidates.map((w) => w.id), ['w-2', 'w-1']);

  const byVintage = resolveWineByName(wines, 'Barolo 2016');
  assert.equal(byVintage.status, 'resolved');
  assert.equal(byVintage.status === 'resolved' && byVintage.wine.id, 'w-1');

  const fuzzy = resolveWineByName(wines, 'raveneau chab');
  assert.equal(fuzzy.status, 'none');

  const partial = resolveWineByName(wines, 'chab');
  assert.equal(partial.status, 'resolved');
  assert.equal(partial.status === 'resolved' && partial.matchKind, 'single_candidate');

  assert.equal(resolveWineByName(wines, '').status, 'none');
  assert.equal(resolveWineByName(wines, 'Rioja 2015').status, 'none');
});
