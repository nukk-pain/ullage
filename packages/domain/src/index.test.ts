import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forbiddenAppendOnlyFields,
  normalizeAddWine,
  normalizeBatchImport,
  normalizeIdempotencyKey,
  optionalDate,
  optionalInt,
  requireName
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
