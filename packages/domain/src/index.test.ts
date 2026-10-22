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
  normalizeQuantity,
  normalizeTastingQuery,
  optionalDate,
  optionalInt,
  optionalTimestamp,
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

test('explicit invalid quantities are rejected across add, update, consume, and import normalization', () => {
  for (const quantity of ['typo', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, ' ', true, [], [3], {}]) {
    assert.throws(() => normalizeAddWine({ name: 'Barolo', quantity }), /quantity must be a non-negative safe integer/);
    assert.throws(() => normalizeBatchImport({
      idempotencyKey: 'invalid-quantity-import', source: 'receipt', items: [{ name: 'Barolo', quantity }]
    }), /quantity must be a non-negative safe integer/);
  }
  assert.throws(() => normalizeQuantity('typo'), /quantity must be a non-negative safe integer/);
  assert.equal(normalizeQuantity(undefined), 1);
  assert.equal(normalizeQuantity(0), 0);
  assert.equal(normalizeQuantity('3'), 3);
});

test('requireName rejects blank names', () => {
  assert.throws(() => requireName('   '), /name is required/);
  assert.throws(() => requireName(undefined), /name is required/);
});

test('optionalDate normalizes to YYYY-MM-DD or null', () => {
  assert.equal(optionalDate('2026-03-14'), '2026-03-14');
  assert.equal(optionalDate('2026-03-14 15:42'), '2026-03-14');
  assert.equal(optionalDate('2026-03-14T10:00:00.000Z'), '2026-03-14');
  assert.equal(optionalDate(undefined), null);
  assert.throws(() => optionalDate('not a date'), /valid YYYY-MM-DD date/);
  assert.throws(() => optionalDate('2030-02-31'), /valid YYYY-MM-DD date/);
  assert.throws(() => optionalDate('2026-03-14suffix'), /valid YYYY-MM-DD date/);
  assert.throws(() => optionalDate('2026-02-31 15:42'), /valid YYYY-MM-DD date/);
  for (const invalid of ['2026-03-14 25:99', '2026-03-14Tgarbage', '2026-03-14T23:00:00+25:00', '2026-03-14 15:42:99', '2026-03-14T10:00:00.1Z']) {
    assert.throws(() => optionalDate(invalid), /valid YYYY-MM-DD date/);
  }
  assert.throws(() => normalizeBatchImport({
    idempotencyKey: 'invalid-date-import', source: 'receipt', purchaseDate: '2026-02-31', items: [{ name: 'Barolo' }]
  }), /valid YYYY-MM-DD date/);
  assert.equal(optionalInt('2019'), 2019);
  assert.throws(() => optionalInt('nope', 'vintage'), /vintage must be a safe integer/);
  for (const value of [true, [], {}]) assert.throws(() => optionalInt(value, 'limit'), /limit must be a safe integer/);
});

test('optionalTimestamp normalizes real calendar dates with a space separator', () => {
  assert.equal(optionalTimestamp('2026-03-14 15:42', 'consumedAt'), new Date('2026-03-14 15:42').toISOString());
  assert.equal(optionalTimestamp('2026-03-14T10:00:00.000Z', 'consumedAt'), '2026-03-14T10:00:00.000Z');
  for (const invalid of ['2026-03-14 25:99', '2026-03-14Tgarbage', '2026-03-14T23:00:00+25:00', '2026-03-14 15:42:99', '2026-03-14T10:00:00.1Z']) {
    assert.throws(() => optionalTimestamp(invalid, 'consumedAt'), /consumedAt/);
  }
  assert.throws(() => optionalTimestamp('2026-02-31 15:42', 'consumedAt'), /consumedAt/);
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

  assert.throws(() => normalizeRecordTasting({ name: 'Barolo', tastedAt: 'not a date' }), /valid YYYY-MM-DD date/);
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

test('filterWines matches multi-token queries regardless of field order', () => {
  const wines = [
    wineFixture({ id: 'paso', name: 'Paso Robles Cabernet Sauvignon', producer: 'Postmark', vintage: 2023 }),
    wineFixture({ id: 'barolo', name: 'Barolo', producer: 'Conterno', region: 'Piedmont' })
  ];
  assert.deepEqual(filterWines(wines, 'Postmark Paso Robles').map((w) => w.id), ['paso']);
  assert.deepEqual(filterWines(wines, 'cabernet  postmark').map((w) => w.id), ['paso']);
  assert.deepEqual(filterWines(wines, 'piedmont conterno barolo').map((w) => w.id), ['barolo']);
  assert.equal(filterWines(wines, 'postmark barolo').length, 0);
});

test('resolveWineByName does not resolve an out-of-stock exact name over in-stock producer matches', () => {
  const wines = [
    wineFixture({ id: 'postmark-2022', name: 'POSTMARK', producer: 'Postmark', vintage: 2022, quantity: 0 }),
    wineFixture({ id: 'postmark-2023', name: 'Paso Robles Cabernet Sauvignon', producer: 'Postmark', vintage: 2023, quantity: 1 })
  ];

  const byProducer = resolveWineByName(wines, 'postmark');
  assert.equal(byProducer.status, 'ambiguous');
  assert.deepEqual(byProducer.status === 'ambiguous' && byProducer.candidates.map((w) => w.id), ['postmark-2023', 'postmark-2022']);

  const fullPhrase = resolveWineByName(wines, 'Postmark Paso Robles Cabernet Sauvignon 2023');
  assert.equal(fullPhrase.status, 'resolved');
  assert.equal(fullPhrase.status === 'resolved' && fullPhrase.wine.id, 'postmark-2023');

  // An in-stock exact name still wins over other producer matches.
  const inStockExact = resolveWineByName([{ ...wines[0]!, quantity: 2 }, wines[1]!], 'postmark');
  assert.equal(inStockExact.status === 'resolved' && inStockExact.matchKind, 'exact');
  assert.equal(inStockExact.status === 'resolved' && inStockExact.wine.id, 'postmark-2022');

  // A lone out-of-stock exact name still resolves, as does one whose other matches are also out of stock.
  const lone = resolveWineByName([wines[0]!], 'postmark');
  assert.equal(lone.status === 'resolved' && lone.wine.id, 'postmark-2022');
  const allEmpty = resolveWineByName([wines[0]!, { ...wines[1]!, quantity: 0 }], 'postmark');
  assert.equal(allEmpty.status === 'resolved' && allEmpty.wine.id, 'postmark-2022');
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
  const wrongVintage = resolveWineByName([wineFixture({ id: 'w-4', name: 'Chablis', vintage: 2019 })], 'Chablis 2021');
  assert.equal(wrongVintage.status, 'none');
  const fuzzyCoexists = resolveWineByName([
    wineFixture({ id: 'wrong-vintage', name: 'Chablis 2021 Reserve', vintage: 2019 }),
    wineFixture({ id: 'target-vintage', name: 'Chablis', vintage: 2021 })
  ], 'Chablis 2021');
  assert.equal(fuzzyCoexists.status === 'resolved' && fuzzyCoexists.wine.id, 'target-vintage');
  const fuzzyOnly = resolveWineByName([wineFixture({ id: 'wrong-vintage', name: 'Chablis 2021 Reserve', vintage: 2019 })], 'Chablis 2021');
  assert.equal(fuzzyOnly.status, 'none');
  const yearName = resolveWineByName([wineFixture({ id: 'w-5', name: 'Barolo 2017', vintage: null })], 'Barolo 2017');
  assert.equal(yearName.status, 'resolved');
  assert.equal(yearName.status === 'resolved' && yearName.wine.id, 'w-5');
  assert.equal(yearName.status === 'resolved' && yearName.matchKind, 'exact');
  const vintageName = resolveWineByName([
    wineFixture({ id: 'name-exact', name: 'Barolo 2017', vintage: null }),
    wineFixture({ id: 'vintage-exact', name: 'Barolo', vintage: 2017 })
  ], 'Barolo 2017');
  assert.equal(vintageName.status === 'resolved' && vintageName.wine.id, 'name-exact');
  const sameVintageFuzzyBoundary = resolveWineByName([
    wineFixture({ id: 'grand-cru', name: 'Chablis 2019 Grand Cru', vintage: 2019 }),
    wineFixture({ id: 'base-name', name: 'Chablis', vintage: 2019 })
  ], 'Chablis 2019');
  assert.equal(sameVintageFuzzyBoundary.status === 'resolved' && sameVintageFuzzyBoundary.wine.id, 'base-name');
});
