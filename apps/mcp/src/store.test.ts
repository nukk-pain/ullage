import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('update and consume reject explicitly invalid quantities without changing stock', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Barolo', quantity: 10 });

  assert.throws(() => store.updateWine(wine.id, { quantity: 'typo' }), /quantity must be a non-negative safe integer/);
  assert.throws(() => store.consumeWine(wine.id, { quantity: 1.5 }), /quantity must be a non-negative safe integer/);
  assert.equal(store.getWine(wine.id)?.quantity, 10);
  assert.equal(store.listConsumptions(wine.id).length, 0);
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

test('record_tasting stores an external tasting without touching inventory, idempotently', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Barolo', quantity: 2 });

  const tasting = store.recordTasting(
    { name: 'Brunello di Montalcino', tastedAt: '2026-07-30', venue: 'Osteria Roma', vintage: 2019, rating: 4.5, foodPairing: ['bistecca'], price: 18, currency: 'EUR', imageUrl: 'https://example.test/tasting.jpg' },
    { idempotencyKey: 'tasting-1' }
  );
  assert.equal(tasting.source, 'external');
  assert.equal(tasting.wineName, 'Brunello di Montalcino');
  assert.deepEqual(tasting.foodPairing, ['bistecca']);
  assert.equal(tasting.imageUrl, 'https://example.test/tasting.jpg');
  assert.equal(store.getWine(wine.id)?.quantity, 2); // inventory untouched

  const replay = store.recordTasting(
    { name: 'Brunello di Montalcino', tastedAt: '2026-07-30', venue: 'Osteria Roma', vintage: 2019, rating: 4.5, foodPairing: ['bistecca'], price: 18, currency: 'EUR', imageUrl: 'https://example.test/tasting.jpg' },
    { idempotencyKey: 'tasting-1' }
  );
  assert.deepEqual(replay, tasting);
  assert.equal(store.listTastings({ source: 'external' }).length, 1);
  assert.equal(store.listActivity()[0]?.action, 'tasting');
});

test('list_tastings merges cellar pours and external tastings newest-first with filters', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Chablis', producer: 'Raveneau', quantity: 1 });
  store.consumeWine(wine.id, { quantity: 1, rating: 3, notes: 'a bit tight' });
  store.recordTasting({ name: 'Barolo', tastedAt: '2099-01-01', venue: 'Osteria', rating: 4.5 }, { idempotencyKey: 't-1' });

  const all = store.listTastings();
  assert.equal(all.length, 2);
  assert.equal(all[0]?.source, 'external'); // 2099 sorts first
  assert.equal(all[1]?.source, 'cellar');
  assert.equal(all[1]?.wineName, 'Chablis');
  assert.equal(all[1]?.producer, 'Raveneau');

  assert.deepEqual(store.listTastings({ source: 'cellar' }).map((t) => t.wineName), ['Chablis']);
  assert.deepEqual(store.listTastings({ minRating: 4 }).map((t) => t.wineName), ['Barolo']);
  assert.deepEqual(store.listTastings({ venue: 'osteria' }).map((t) => t.wineName), ['Barolo']);
  assert.deepEqual(store.listTastings({ query: 'raveneau' }).map((t) => t.wineName), ['Chablis']);
});

test('update_consumption patches rating/notes, honors clear flags, and preserves the rest', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Sancerre', quantity: 2 });
  store.consumeWine(wine.id, { quantity: 1, notes: 'first pour' });
  const event = store.listConsumptions(wine.id)[0];

  const rated = store.updateConsumption(event.id, { rating: 4 });
  assert.equal(rated.rating, 4);
  assert.equal(rated.notes, 'first pour'); // untouched

  const cleared = store.updateConsumption(event.id, { clearRating: true, notes: 'do not rebuy' });
  assert.equal(cleared.rating, null);
  assert.equal(cleared.notes, 'do not rebuy');
  assert.equal(store.listConsumptions(wine.id)[0]?.rating, null); // persisted
  assert.equal(store.listActivity()[0]?.action, 'consume_update');

  assert.throws(() => store.updateConsumption('missing-event', { rating: 4 }), /No consumption event/);
});

test('list_wines query and resolve_wine work against the live store', () => {
  const store = new SqliteCellarStore(':memory:');
  store.addWine({ name: 'Barolo', vintage: 2016, quantity: 0 });
  const inStock = store.addWine({ name: 'Barolo', vintage: 2019, quantity: 1 });
  store.addWine({ name: 'Chablis', producer: 'Raveneau', quantity: 1 });

  assert.deepEqual(store.listWines('raveneau').map((w) => w.name), ['Chablis']);

  const ambiguous = store.resolveWine('Barolo');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.status === 'ambiguous' && ambiguous.candidates[0]?.id, inStock.id); // in-stock first

  const byVintage = store.resolveWine('Barolo 2016');
  assert.equal(byVintage.status, 'resolved');
  assert.equal(byVintage.status === 'resolved' && byVintage.wine.vintage, 2016);
});

test('schema upgrade is additive: a pre-tastings DB file keeps its data and gains tastings', async () => {
  const { unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const dbPath = join(tmpdir(), `ullage-migration-${randomUUID()}.db`);

  const before = new SqliteCellarStore(dbPath);
  const wine = before.addWine({ name: 'Champagne', quantity: 2 });
  before.consumeWine(wine.id, { quantity: 1, rating: 5 });
  before.close();

  // Strip the new table so the file looks like a DB created by an older build.
  const { default: Database } = await import('better-sqlite3');
  const raw = new Database(dbPath);
  raw.exec('DROP INDEX IF EXISTS idx_tastings_time; DROP TABLE IF EXISTS tastings;');
  raw.close();

  // Re-opening (as a newer build would) must not disturb existing rows.
  const after = new SqliteCellarStore(dbPath);
  assert.equal(after.listWines().length, 1);
  assert.equal(after.listConsumptions().length, 1);
  after.recordTasting({ name: 'Barolo', tastedAt: '2026-07-30' }, { idempotencyKey: 'mig-1' });
  assert.equal(after.listTastings().length, 2); // 1 cellar pour + 1 external
  assert.equal(after.exportJson().tastings.length, 1);
  after.close();
  await unlink(dbPath);
});

test('export includes external tastings alongside existing sections', () => {
  const store = new SqliteCellarStore(':memory:');
  store.recordTasting({ name: 'Barolo', tastedAt: '2026-07-30', rating: 4 }, { idempotencyKey: 'exp-1' });
  const exported = store.exportJson();
  assert.equal(exported.tastings.length, 1);
  assert.equal(exported.tastings[0]?.wineName, 'Barolo');
});

test('append-only mode still allows tasting records and pour-metadata fixes', () => {
  const store = new SqliteCellarStore(':memory:', { appendOnly: true });
  const wine = store.addWine({ name: 'Barolo', quantity: 1 }, { idempotencyKey: 'ao-add-1' });
  store.consumeWine(wine.id, { quantity: 1 }, { idempotencyKey: 'ao-consume-1' });
  const event = store.listConsumptions(wine.id)[0];

  // Pour metadata is an event correction, not a wine-identity edit.
  const updated = store.updateConsumption(event.id, { rating: 3 }, { idempotencyKey: 'ao-fix-1' });
  assert.equal(updated.rating, 3);
  const tasting = store.recordTasting({ name: 'Chablis', tastedAt: '2026-07-30' }, { idempotencyKey: 'ao-tasting-1' });
  assert.equal(tasting.wineName, 'Chablis');
});

test('consume_wine accepts consumedAt as a bare date or ISO timestamp, rejects garbage', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Barolo', quantity: 3 });

  store.consumeWine(wine.id, { quantity: 1, consumedAt: '2026-07-30' });
  store.consumeWine(wine.id, { quantity: 1, consumedAt: '2026-07-29T20:15:00.000Z' });
  store.consumeWine(wine.id, { quantity: 1 }); // defaults to now

  const events = store.listConsumptions(wine.id);
  assert.equal(events.length, 3);
  const stamps = events.map((e) => e.consumedAt);
  assert.equal(stamps.includes('2026-07-30T00:00:00.000Z'), true); // bare date expanded
  assert.equal(stamps.includes('2026-07-29T20:15:00.000Z'), true);

  const again = store.addWine({ name: 'Chablis', quantity: 1 });
  assert.throws(() => store.consumeWine(again.id, { consumedAt: 'last tuesday' }), /consumedAt must be/);
  assert.equal(store.getWine(again.id)?.quantity, 1); // failed consume left stock untouched
});

test('hold_wine stores an until date and re-holding updates instead of ignoring', () => {
  const store = new SqliteCellarStore(':memory:');
  const wine = store.addWine({ name: 'Brunello', quantity: 1 });

  const hold = store.holdWine(wine.id, { until: '2030-01-01', reason: 'aging', idempotencyKey: 'h-1' });
  assert.equal(hold.until, '2030-01-01');
  assert.equal(store.getWine(wine.id)?.hold?.until, '2030-01-01');
  assert.equal(store.listHolds()[0]?.until, '2030-01-01');

  // Extend the same hold: until changes, id stays.
  const extended = store.holdWine(wine.id, { until: '2032-01-01', idempotencyKey: 'h-2' });
  assert.equal(extended.id, hold.id);
  assert.equal(extended.until, '2032-01-01');
  assert.equal(extended.reason, 'aging'); // omitted reason preserved

  // Identical re-hold is a no-op returning the current hold.
  const same = store.holdWine(wine.id, { until: '2032-01-01', idempotencyKey: 'h-3' });
  assert.equal(same.id, hold.id);
  assert.equal(same.until, '2032-01-01');
});

test('schema upgrade adds wine_holds.until to a DB created before the column existed', async () => {
  const { unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const { default: Database } = await import('better-sqlite3');
  const dbPath = join(tmpdir(), `ullage-hold-migration-${randomUUID()}.db`);

  // Build an old-shape wine_holds table by hand.
  const raw = new Database(dbPath);
  raw.exec(`CREATE TABLE wine_holds (
    id TEXT PRIMARY KEY, wine_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, released_at TEXT
  );`);
  raw.prepare('INSERT INTO wine_holds VALUES (?, ?, ?, ?, ?)').run('h-old', 'w-1', 'legacy hold', '2026-01-01T00:00:00.000Z', null);
  raw.close();

  const store = new SqliteCellarStore(dbPath);
  const holds = store.listHolds();
  assert.equal(holds.length, 1);
  assert.equal(holds[0]?.until, null); // legacy rows read back with null until
  store.close();
  await unlink(dbPath);
});

test('schema upgrade preserves a legacy tasting source image in imageUrl', async () => {
  const { unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const { default: Database } = await import('better-sqlite3');
  const dbPath = join(tmpdir(), `ullage-tasting-image-migration-${randomUUID()}.db`);

  const raw = new Database(dbPath);
  raw.exec(`CREATE TABLE tastings (
    id TEXT PRIMARY KEY, wine_name TEXT NOT NULL, vintage INTEGER, producer TEXT, region TEXT,
    venue TEXT, food_pairing TEXT, rating REAL, price REAL, currency TEXT, notes TEXT,
    tasted_at TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  raw.prepare('INSERT INTO tastings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't-old', 'Barolo', 2016, null, null, null, null, 4.5, null, null,
    'memorable\nSource image: https://example.test/legacy.jpg', '2026-01-01', '2026-01-01T00:00:00.000Z'
  );
  raw.close();

  const store = new SqliteCellarStore(dbPath);
  assert.equal(store.listTastings({ source: 'external' })[0]?.imageUrl, 'https://example.test/legacy.jpg');
  store.close();
  await unlink(dbPath);
});

test('list_wines inStock filter and summary in-stock counts', () => {
  const store = new SqliteCellarStore(':memory:');
  const gone = store.addWine({ name: 'Champagne', quantity: 1 });
  store.consumeWine(gone.id, { quantity: 1 });
  store.addWine({ name: 'Barolo', quantity: 2 });

  assert.deepEqual(store.listWines(undefined, true).map((w) => w.name), ['Barolo']);
  assert.deepEqual(store.listWines(undefined, false).map((w) => w.name), ['Champagne']);
  assert.equal(store.listWines().length, 2);

  const summary = store.summary();
  assert.equal(summary.wine_count, 1); // in-stock only
  assert.equal(summary.bottle_count, 2);
  assert.equal(summary.consumed_out_count, 1);
  assert.deepEqual(summary.recent_wines.map((w) => w.name), ['Barolo']); // drunk-out wine not "recent"
});

test('import batch-level purchaseDate fills items and lands on the import record', () => {
  const store = new SqliteCellarStore(':memory:');
  const result = store.importWines({
    idempotencyKey: 'batch-meta-1',
    source: 'receipt',
    purchaseDate: '2026-07-15',
    receiptImageUrl: 'https://example.com/receipt.jpg',
    items: [
      { name: 'Barolo', itemKey: 'l1' },
      { name: 'Chablis', purchaseDate: '2026-07-01', itemKey: 'l2' } // own date wins
    ]
  });
  assert.equal(result.purchaseDate, '2026-07-15');
  assert.equal(result.receiptImageUrl, 'https://example.com/receipt.jpg');
  const byName = new Map(result.wines.map((w) => [w.name, w]));
  assert.equal(byName.get('Barolo')?.purchaseDate, '2026-07-15'); // filled down
  assert.equal(byName.get('Chablis')?.purchaseDate, '2026-07-01'); // not overridden
  assert.equal(store.exportJson().imports[0]?.receiptImageUrl, 'https://example.com/receipt.jpg');
});

test('two stores on the same file interleave writes without lock errors', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ullage-concurrency-')), 'cellar.db');
  const first = new SqliteCellarStore(path);
  const second = new SqliteCellarStore(path);
  try {
    const probe = new Database(path);
    assert.equal(probe.pragma('journal_mode', { simple: true }), 'wal');
    probe.close();
    const wine = first.addWine({ name: 'Barolo', quantity: 4 });
    // Interleaved writers stand in for the MCP transport and the HTTP transport running side by side.
    second.consumeWine(wine.id, { quantity: 1 });
    first.consumeWine(wine.id, { quantity: 1 });
    second.addNote(wine.id, 'shared cellar, two writers');
    assert.equal(second.getWine(wine.id)?.quantity, 2);
    assert.equal(first.listConsumptions(wine.id).length, 2);
  } finally {
    first.close();
    second.close();
  }
});
