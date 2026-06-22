import test from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteCellarStore } from './store.js';
import type { CellarStore } from './cellar-store.js';

test('CellarStore contract supports the full cellar lifecycle when backed by SQLite', async () => {
  const dbPath = join(tmpdir(), `ullage-contract-${randomUUID()}.db`);
  const store: CellarStore = new SqliteCellarStore(dbPath);

  const wine = await store.addWine({ name: 'Barolo', producer: 'Conterno', vintage: 2016, quantity: 2 });
  assert.equal(wine.name, 'Barolo');

  const listed = await store.listWines();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, wine.id);

  const fetched = await store.getWine(wine.id);
  assert.equal(fetched?.producer, 'Conterno');

  const updated = await store.updateWine(wine.id, { region: 'Piedmont', quantity: 3 });
  assert.equal(updated?.region, 'Piedmont');
  assert.equal(updated?.quantity, 3);

  const consumed = await store.consumeWine(wine.id, { quantity: 1, rating: 4.5, notes: 'classic' });
  assert.equal(consumed?.quantity, 2);

  const consumptions = await store.listConsumptions(wine.id);
  assert.equal(consumptions.length, 1);
  assert.equal(consumptions[0]?.rating, 4.5);

  const note = await store.addNote(wine.id, 'tar and roses', 4.8);
  assert.equal(note.note, 'tar and roses');

  const notes = await store.listNotes(wine.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.rating, 4.8);

  const activity = await store.listActivity(10);
  assert.deepEqual(activity.map((entry) => entry.action), ['note', 'consume', 'update', 'add']);

  const summary = await store.summary();
  assert.equal(summary.wine_count, 1);
  assert.equal(summary.bottle_count, 2);

  const exported = await store.exportJson();
  assert.equal(exported.wines.length, 1);
  assert.equal(exported.consumptions.length, 1);
  assert.equal(exported.notes.length, 1);
  assert.equal(exported.activity.length, 4);

  await store.close();
  await unlink(dbPath);
});

test('CellarStore production contract supports batch import holds notes recommendations and export', async () => {
  const dbPath = join(tmpdir(), `ullage-contract-production-${randomUUID()}.db`);
  const store: CellarStore = new SqliteCellarStore(dbPath);

  const batch = await store.importWines({
    idempotencyKey: 'receipt-chat-1',
    source: 'receipt',
    sourceId: 'receipt-2026-06-21',
    items: [
      { name: 'Barolo', producer: 'Conterno', vintage: 2016, quantity: 2, itemKey: 'line-1' },
      { name: 'Chablis', producer: 'Raveneau', vintage: 2020, quantity: 1, itemKey: 'line-2' }
    ]
  });
  assert.equal(batch.wines.length, 2);

  const replay = await store.importWines({
    idempotencyKey: 'receipt-chat-1',
    source: 'receipt',
    sourceId: 'receipt-2026-06-21',
    items: [
      { name: 'Barolo', producer: 'Conterno', vintage: 2016, quantity: 2, itemKey: 'line-1' },
      { name: 'Chablis', producer: 'Raveneau', vintage: 2020, quantity: 1, itemKey: 'line-2' }
    ]
  });
  assert.deepEqual(replay, batch);
  assert.equal((await store.listWines()).length, 2);

  const held = await store.holdWine(batch.wines[0].id, { idempotencyKey: 'hold-chat-1', reason: 'Anniversary dinner' });
  assert.equal(held.reason, 'Anniversary dinner');
  assert.equal((await store.getWine(batch.wines[0].id))?.hold?.reason, 'Anniversary dinner');
  assert.equal((await store.listHolds()).length, 1);
  await assert.rejects(async () => store.consumeWine(batch.wines[0].id, { quantity: 1 }, { idempotencyKey: 'consume-held-1' }), /hold/i);

  const recommendations = await store.recommendWines({ occasion: 'fried chicken', limit: 5 });
  assert.equal(recommendations.recommendations.some((entry) => entry.wine.id === batch.wines[0].id), false);
  assert.equal(recommendations.excludedHeld.some((entry) => entry.id === batch.wines[0].id), true);

  const released = await store.releaseHold(batch.wines[0].id, { idempotencyKey: 'release-chat-1' });
  assert.equal(released.wineId, batch.wines[0].id);
  await store.consumeWine(batch.wines[0].id, { quantity: 1, notes: 'opened after release' }, { idempotencyKey: 'consume-chat-1' });
  await store.addNote(batch.wines[1].id, 'saline and bright', 4.2, { idempotencyKey: 'note-chat-1' });

  const exported = await store.exportJson();
  assert.equal(exported.holds.length, 1);
  assert.equal(exported.imports.length, 1);
  assert.equal(exported.activity.some((entry) => entry.action === 'hold'), true);
  assert.equal(exported.activity.some((entry) => entry.action === 'release'), true);

  await store.close();
  await unlink(dbPath);
});

test('CellarStore production contract rejects idempotency mismatch and held consumption', async () => {
  const store: CellarStore = new SqliteCellarStore(':memory:');

  const added = await store.addWine({ name: 'Sancerre', quantity: 2 }, { idempotencyKey: 'add-chat-1' });
  const replay = await store.addWine({ name: 'Sancerre', quantity: 2 }, { idempotencyKey: 'add-chat-1' });
  assert.deepEqual(replay, added);
  await assert.rejects(async () => store.addWine({ name: 'Pouilly-Fume', quantity: 2 }, { idempotencyKey: 'add-chat-1' }), /different payload/);
  assert.equal((await store.listWines()).length, 1);

  await assert.rejects(
    async () =>
      store.importWines({
        idempotencyKey: 'bad-receipt-chat-1',
        source: 'receipt',
        items: [{ name: 'Barolo', itemKey: 'line-1' }, { kind: 'non_wine', name: 'wine opener', itemKey: 'line-2' }]
      }),
    /non-wine receipt row/
  );
  assert.equal((await store.listWines()).length, 1);

  await store.holdWine(added.id, { idempotencyKey: 'hold-chat-2', reason: 'Do not open' });
  await assert.rejects(async () => store.consumeWine(added.id, { quantity: 1 }, { idempotencyKey: 'consume-held-2' }), /hold/i);
  assert.equal((await store.getWine(added.id))?.quantity, 2);
});

test('CellarStore production contract replays idempotent missing targets without SQLite errors', async () => {
  const store: CellarStore = new SqliteCellarStore(':memory:');

  assert.equal(await store.updateWine('missing-wine', { region: 'Loire' }, { idempotencyKey: 'missing-update-1' }), undefined);
  assert.equal(await store.updateWine('missing-wine', { region: 'Loire' }, { idempotencyKey: 'missing-update-1' }), undefined);
  assert.equal(await store.consumeWine('missing-wine', { quantity: 1 }, { idempotencyKey: 'missing-consume-1' }), undefined);
  assert.equal(await store.consumeWine('missing-wine', { quantity: 1 }, { idempotencyKey: 'missing-consume-1' }), undefined);
  assert.deepEqual(await store.listActivity(), []);
});

test('CellarStore production contract rejects identity edits in append-only SQLite mode', async () => {
  const store: CellarStore = new SqliteCellarStore(':memory:', { appendOnly: true });
  const wine = await store.addWine({ name: 'Barolo', producer: 'Conterno', quantity: 1 }, { idempotencyKey: 'append-add-1' });

  await assert.rejects(async () => store.updateWine(wine.id, { name: 'Different Barolo' }, { idempotencyKey: 'append-update-1' }), /append-only/i);
  await store.addNote(wine.id, 'cellar note', 4, { idempotencyKey: 'append-note-1' });
  await store.holdWine(wine.id, { idempotencyKey: 'append-hold-1', reason: 'wait' });
  await store.releaseHold(wine.id, { idempotencyKey: 'append-release-1' });
  await store.consumeWine(wine.id, { quantity: 1 }, { idempotencyKey: 'append-consume-1' });

  assert.deepEqual((await store.listActivity()).map((entry) => entry.action), ['consume', 'release', 'hold', 'note', 'add']);
});
