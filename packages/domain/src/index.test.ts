import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddWine, optionalDate, optionalInt, requireName } from './index.js';

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
