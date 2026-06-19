import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCellarStore } from './store.js';

test('add, list, and summarize wines (rich fields)', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Barolo', producer: 'Conterno', vintage: 2016, varietal: 'Nebbiolo', region: 'Piedmont', quantity: 3, drinkByDate: '2035-01-01' });
  assert.equal(wine.name, 'Barolo');
  assert.equal(wine.vintage, 2016);
  assert.equal(wine.varietal, 'Nebbiolo');
  assert.equal(wine.drinkByDate, '2035-01-01');
  assert.equal(wine.quantity, 3);

  store.addWine({ name: 'Chablis', vintage: 2020 }); // quantity defaults to 1
  assert.equal(store.summary().wine_count, 2);
  assert.equal(store.summary().bottle_count, 4);
});

test('consume decrements quantity and logs a per-pour event (wine rating untouched)', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Brunello', quantity: 2 });
  const after = store.consumeWine(wine.id, { quantity: 1, rating: 4.5, notes: 'opened' });
  assert.equal(after?.quantity, 1);
  assert.equal(after?.rating, null); // the pour rating lands on the event, not the wine

  const history = store.listConsumptions(wine.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].quantity, 1);
  assert.equal(history[0].rating, 4.5);
  assert.equal(history[0].notes, 'opened');
});

test('consume never records more than is on hand, and rejects when empty', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Barolo', quantity: 1 });
  const after = store.consumeWine(wine.id, { quantity: 5 }); // ask for more than in stock
  assert.equal(after?.quantity, 0);
  assert.equal(store.listConsumptions(wine.id)[0].quantity, 1); // only 1 actually consumed
  assert.throws(() => store.consumeWine(wine.id, { quantity: 1 }), /No bottles/); // none left
});

test('update_wine changes only provided fields', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Sancerre', producer: 'Cotat', vintage: 2021 });
  const updated = store.updateWine(wine.id, { region: 'Loire', quantity: 6 });
  assert.equal(updated?.region, 'Loire');
  assert.equal(updated?.quantity, 6);
  assert.equal(updated?.producer, 'Cotat'); // unchanged
  assert.equal(updated?.vintage, 2021); // unchanged
});

test('add requires a name', () => {
  const store = new SqliteCellarStore(':memory:');
  assert.throws(() => store.addWine({ name: '   ' }), /name is required/);
});

test('export includes wines, consumptions, notes, and activity', () => {
  const store = new SqliteCellarStore(':memory:');
  const w = store.addWine({ name: 'Champagne', quantity: 2 });
  store.consumeWine(w.id, { quantity: 1 });
  const dump = store.exportJson();
  assert.equal(dump.wines.length, 1);
  assert.equal(dump.consumptions.length, 1);
});

test('tasting notes form a per-wine timeline (without consuming)', () => {
  const store = new SqliteCellarStore(':memory:');
  const w = store.addWine({ name: 'Riesling', quantity: 1 });
  store.addNote(w.id, 'Petrol on the nose, still tight.', 3.8);
  store.addNote(w.id, 'Opening up — lime and honey.');
  const notes = store.listNotes(w.id);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].note, 'Opening up — lime and honey.'); // newest first
  assert.equal(notes[1].rating, 3.8);
  assert.equal(store.getWine(w.id)?.quantity, 1); // adding a note does not consume
});

test('add_note requires a non-empty note and a real wine', () => {
  const store = new SqliteCellarStore(':memory:');
  const w = store.addWine({ name: 'Barolo' });
  assert.throws(() => store.addNote(w.id, '   '), /note is required/);
  assert.throws(() => store.addNote('nope', 'x'), /No wine with id/);
});

test('activity log captures add, update, consume, and note', () => {
  const store = new SqliteCellarStore(':memory:');
  const w = store.addWine({ name: 'Sancerre', quantity: 2 });
  store.updateWine(w.id, { region: 'Loire' });
  store.consumeWine(w.id, { quantity: 1, rating: 4 });
  store.addNote(w.id, 'crisp');
  const actions = store.listActivity().map((a) => a.action);
  assert.deepEqual(actions, ['note', 'consume', 'update', 'add']); // newest first
});
