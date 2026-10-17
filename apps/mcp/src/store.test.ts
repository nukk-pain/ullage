import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SqliteCellarStore } from './store.js';
import { hashPayload } from './sqlite-rows.js';
import { normalizeBatchImport } from '@ullage/domain';

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

  for (const quantity of [' ', true, [], [3], {}]) {
    assert.throws(() => store.addWine({ name: 'invalid', quantity }), /quantity must be a non-negative safe integer/);
    assert.throws(() => store.updateWine(wine.id, { quantity }), /quantity must be a non-negative safe integer/);
    assert.throws(() => store.consumeWine(wine.id, { quantity }), /quantity must be a non-negative safe integer/);
    assert.throws(() => store.importWines({ idempotencyKey: `invalid-${String(quantity)}`, source: 'receipt', items: [{ name: 'invalid', quantity }] }), /quantity must be a non-negative safe integer/);
  }
  assert.throws(() => store.updateWine(wine.id, { quantity: 'typo' }), /quantity must be a non-negative safe integer/);
  assert.throws(() => store.consumeWine(wine.id, { quantity: 1.5 }), /quantity must be a non-negative safe integer/);
  assert.equal(store.getWine(wine.id)?.quantity, 10);
  assert.equal(store.listConsumptions(wine.id).length, 0);
  assert.equal(store.listWines().length, 1);
  assert.equal(store.listActivity().length, 1);
  assert.equal(store.exportJson().imports.length, 0);
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

test('all stored date fields reject impossible calendar dates', () => {
  const store = new SqliteCellarStore(':memory:');
  assert.throws(() => store.addWine({ name: 'Invalid purchase', purchaseDate: '2026-02-31' }), /valid YYYY-MM-DD date/);
  assert.throws(() => store.addWine({ name: 'Invalid drink-by', drinkByDate: '2026-13-45' }), /valid YYYY-MM-DD date/);
  const wine = store.addWine({ name: 'Barolo', quantity: 2 });
  assert.throws(() => store.consumeWine(wine.id, { consumedAt: '2026-02-31' }), /valid YYYY-MM-DD date/);
  assert.throws(() => store.consumeWine(wine.id, { consumedAt: '2026-02-31T12:00:00.000Z' }), /valid YYYY-MM-DD date/);
  assert.throws(() => store.recordTasting({ name: 'Barolo', tastedAt: '2026-02-31' }), /valid YYYY-MM-DD date/);
  assert.throws(() => store.holdWine(wine.id, { until: '2026-02-31' }), /valid YYYY-MM-DD date/);
  assert.equal(store.getWine(wine.id)?.quantity, 2);
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

  const reasonOnly = store.holdWine(wine.id, { reason: 'anniversary', idempotencyKey: 'h-reason' });
  assert.equal(reasonOnly.until, '2032-01-01');
  const cleared = store.holdWine(wine.id, { until: null, idempotencyKey: 'h-clear' });
  assert.equal(cleared.until, null);

  // Identical re-hold is a no-op returning the current hold.
  const same = store.holdWine(wine.id, { until: null, idempotencyKey: 'h-3' });
  assert.equal(same.id, hold.id);
  assert.equal(same.until, null);
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

test('schema upgrade extracts only the legacy image URL token and preserves existing imageUrl values', async () => {
  const { unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const { default: Database } = await import('better-sqlite3');
  const dbPath = join(tmpdir(), `ullage-tasting-image-migration-${randomUUID()}.db`);

  const raw = new Database(dbPath);
  raw.exec(`CREATE TABLE tastings (
    id TEXT PRIMARY KEY, wine_name TEXT NOT NULL, vintage INTEGER, producer TEXT, region TEXT,
    venue TEXT, food_pairing TEXT, rating REAL, price REAL, currency TEXT, notes TEXT, image_url TEXT,
    tasted_at TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  raw.prepare('INSERT INTO tastings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't-old', 'Barolo', 2016, null, null, null, null, 4.5, null, null,
    'memorable\nSource image: https://example.test/legacy.jpg trailing text', null, '2026-01-01', '2026-01-01T00:00:00.000Z'
  );
  raw.prepare(`INSERT INTO tastings (id, wine_name, notes, image_url, tasted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('t-existing', 'Existing image', 'Source image: ignored.example/page', 'https://example.test/kept.jpg', '2026-01-02', '2026-01-02T00:00:00.000Z');
  raw.close();

  const store = new SqliteCellarStore(dbPath);
  const tastings = store.listTastings({ source: 'external' });
  assert.equal(tastings.find((tasting) => tasting.wineName === 'Barolo')?.imageUrl, 'https://example.test/legacy.jpg');
  assert.equal(tastings.find((tasting) => tasting.wineName === 'Existing image')?.imageUrl, 'https://example.test/kept.jpg');
  store.recordTasting({ name: 'New tasting', notes: 'Source image: https://example.test/new.jpg', tastedAt: '2026-01-03' });
  store.close();
  const reopened = new SqliteCellarStore(dbPath);
  assert.equal(reopened.listTastings({ source: 'external' }).find((tasting) => tasting.wineName === 'New tasting')?.imageUrl, null);
  reopened.close();
  await unlink(dbPath);
});

test('schema migration releases older duplicate active holds and keeps the newest hold', async () => {
  const { rmSync } = await import('node:fs');
  const { randomUUID } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'ullage-duplicate-holds-'));
  const dbPath = join(dir, 'cellar.db');
  const seed = new SqliteCellarStore(dbPath);
  const wine = seed.addWine({ name: 'Duplicate hold wine', quantity: 3 });
  seed.holdWine(wine.id, { reason: 'older' });
  seed.close();

  const legacy = new Database(dbPath);
  legacy.exec('DROP INDEX IF EXISTS idx_holds_active_wine_unique');
  const newestId = `hold-${randomUUID()}`;
  legacy.prepare(`INSERT INTO wine_holds (id, wine_id, reason, until, created_at, released_at)
    VALUES (?, ?, ?, ?, ?, NULL)`).run(newestId, wine.id, 'newest', null, '2099-01-01T00:00:00.000Z');
  legacy.close();

  const migrated = new SqliteCellarStore(dbPath);
  try {
    assert.deepEqual(migrated.listHolds().map((hold) => hold.id), [newestId]);
    assert.equal(migrated.getWine(wine.id)?.hold?.id, newestId);
    assert.equal(migrated.summary().bottle_count, 3);
    const probe = new Database(dbPath);
    try {
      assert.equal(probe.prepare('SELECT COUNT(*) AS count FROM wine_holds WHERE wine_id = ? AND released_at IS NULL').get(wine.id)?.count, 1);
      assert.equal(probe.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?').get('index', 'idx_holds_active_wine_unique')?.count, 1);
    } finally {
      probe.close();
    }
  } finally {
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two processes can concurrently migrate an old schema without losing data', async () => {
  const { rmSync, writeFileSync } = await import('node:fs');
  const { randomUUID } = await import('node:crypto');
  const helper = fileURLToPath(new URL('./schema-migration-race-child.ts', import.meta.url));

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const dir = mkdtempSync(join(tmpdir(), 'ullage-schema-race-'));
    const dbPath = join(dir, 'cellar.db');
    const gatePath = join(dir, 'start');
    const seed = new SqliteCellarStore(dbPath);
    const wine = seed.addWine({ name: 'Migration seed', quantity: 3 }, { idempotencyKey: `seed-${randomUUID()}` });
    seed.holdWine(wine.id, { reason: 'legacy hold' });
    seed.recordTasting({ name: 'Legacy tasting', tastedAt: '2026-01-01' });
    seed.close();

    const legacy = new Database(dbPath);
    legacy.prepare('UPDATE tastings SET notes = ?, image_url = NULL').run('Source image: https://example.test/legacy.jpg');
    legacy.exec(`
      ALTER TABLE wine_holds DROP COLUMN "until";
      ALTER TABLE tastings DROP COLUMN image_url;
      ALTER TABLE idempotency_keys DROP COLUMN hash_version;
      DROP TABLE schema_meta;
    `);
    legacy.close();

    const children: ChildProcess[] = [];
    try {
      children.push(...[0, 1].map(() => spawn(process.execPath, ['--import', 'tsx', helper, dbPath, gatePath], {
        stdio: ['ignore', 'pipe', 'pipe']
      })));
      const outputs = children.map(() => ({ stdout: '', stderr: '' }));
      let readyCount = 0;
      let releaseGate: (() => void) | undefined;
      let rejectReady: ((error: Error) => void) | undefined;
      const bothReady = new Promise<void>((resolve, reject) => {
        releaseGate = resolve;
        rejectReady = reject;
      });
      const exits = children.map((child, index) => new Promise<number>((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          outputs[index]!.stdout += chunk;
          if (outputs[index]!.stdout.includes('READY') && outputs[index]!.stdout.match(/READY/g)?.length === 1) {
            readyCount += 1;
            if (readyCount === children.length) releaseGate?.();
          }
        });
        child.stderr.on('data', (chunk: string) => { outputs[index]!.stderr += chunk; });
        child.once('error', reject);
        child.once('exit', (code) => {
          if (!outputs[index]!.stdout.includes('READY')) rejectReady?.(new Error(`${outputs[index]!.stdout}${outputs[index]!.stderr}`));
          resolve(code ?? 1);
        });
      }));

      await withTimeout(bothReady, 10_000, 'child processes to become ready');
      writeFileSync(gatePath, 'go');
      const codes = await withTimeout(Promise.all(exits), 10_000, 'child processes to finish migration');
      assert.deepEqual(codes, [0, 0], outputs.map((output) => `${output.stdout}${output.stderr}`).join('\n'));
      assert.equal(outputs.every((output) => output.stdout.includes('OK 1')), true);

      const migrated = new Database(dbPath);
      try {
        for (const [table, column] of [['wine_holds', 'until'], ['tastings', 'image_url'], ['idempotency_keys', 'hash_version']]) {
          const columns = migrated.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
          assert.equal(columns.filter((entry) => entry.name === column).length, 1);
        }
        assert.equal(migrated.prepare('SELECT count(*) AS count FROM wines WHERE id = ?').get(wine.id)?.count, 1);
        assert.equal(migrated.prepare('SELECT count(*) AS count FROM wine_holds WHERE wine_id = ? AND reason = ?').get(wine.id, 'legacy hold')?.count, 1);
        assert.equal(migrated.prepare('SELECT image_url FROM tastings WHERE wine_name = ?').get('Legacy tasting')?.image_url, 'https://example.test/legacy.jpg');
        assert.equal(migrated.prepare('SELECT hash_version FROM idempotency_keys WHERE idempotency_key LIKE ?').get('seed-%')?.hash_version, null);
      } finally {
        migrated.close();
      }
    } finally {
      await stopChildren(children);
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function stopChildren(children: readonly ChildProcess[]): Promise<void> {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.all(children.map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 500);
      child.once('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
    });
  }));
}

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

test('legacy timestamp imports replay by the same key and request after reopening', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ullage-legacy-replay-')), 'cellar.db');
  const input = { idempotencyKey: 'old-timestamp-import', source: 'receipt' as const, purchaseDate: '2026-03-14 15:42', items: [{ name: 'Legacy', quantity: '3' }] };
  const first = new SqliteCellarStore(path);
  const original = first.importWines(input);
  first.close();
  const reopened = new SqliteCellarStore(path);
  try {
    const replay = reopened.importWines(input);
    assert.equal(replay.id, original.id);
    assert.equal(reopened.listWines().length, 1);
  } finally {
    reopened.close();
  }
});

test('legacy imports with invalid dates and null or empty quantities replay before current validation', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ullage-legacy-import-')), 'cellar.db');
  const store = new SqliteCellarStore(path);
  const cases = [
    { idempotencyKey: 'legacy-invalid-date', source: 'receipt' as const, purchaseDate: '2026-02-31', items: [{ name: 'Legacy date', quantity: 1 }] },
    { idempotencyKey: 'legacy-null-quantity', source: 'receipt' as const, items: [{ name: 'Legacy null', quantity: null }] },
    { idempotencyKey: 'legacy-empty-quantity', source: 'receipt' as const, items: [{ name: 'Legacy empty', quantity: '' }] }
  ];
  const normalizedLegacy = cases.map((input) => {
    const legacyDate = typeof input.purchaseDate === 'string' ? input.purchaseDate : null;
    const normalized = normalizeBatchImport({
      ...input,
      purchaseDate: legacyDate === null ? undefined : '2026-03-14',
      items: input.items.map((item) => ({ ...item, quantity: item.quantity === null || item.quantity === '' ? undefined : item.quantity }))
    });
    return {
      ...normalized,
      purchaseDate: legacyDate,
      items: normalized.items.map((item) => ({ ...item, purchaseDate: legacyDate ?? item.purchaseDate }))
    };
  });
  const expectedResults = new Map<string, { id: string; name: string }>();
  for (const [index, input] of cases.entries()) {
    const seed = store.importWines({ ...input, idempotencyKey: `seed-${input.idempotencyKey}`, purchaseDate: '2026-03-14', items: input.items.map((item) => ({ ...item, quantity: item.quantity === null || item.quantity === '' ? undefined : item.quantity })) });
    const seedWines = seed.wines.map((wine) => ({ ...wine, purchaseDate: input.purchaseDate ?? wine.purchaseDate }));
    const result = { ...seed, purchaseDate: input.purchaseDate ?? null, wines: seedWines };
    const raw = new Database(path);
    const seedRow = raw.prepare('SELECT result_json, created_at FROM idempotency_keys WHERE idempotency_key = ?').get(`seed-${input.idempotencyKey}`) as { result_json: string; created_at: string };
    const legacyResultJson = JSON.stringify({ kind: 'value', result });
    raw.prepare('UPDATE batch_imports SET result_json = ? WHERE id = ?').run(JSON.stringify(result), seed.id);
    raw.prepare('INSERT INTO idempotency_keys (idempotency_key, operation, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      input.idempotencyKey,
      'importWines',
      hashPayload('importWines', normalizedLegacy[index]),
      legacyResultJson,
      seedRow.created_at
    );
    raw.close();
    expectedResults.set(input.idempotencyKey, { id: seed.id, name: input.items[0]?.name ?? '' });
  }
  store.close();
  const reopened = new SqliteCellarStore(path);
  try {
    for (const input of cases) {
      const expected = expectedResults.get(input.idempotencyKey);
      const replay = reopened.importWines(input);
      assert.equal(replay.id, expected?.id);
      assert.equal(reopened.listWines(expected?.name).length, 1);
    }
  } finally {
    reopened.close();
  }
});

test('legacy import replay reconstructs bff7e55 drink dates and integer coercion', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ullage-legacy-replay-')), 'cellar.db');
  const store = new SqliteCellarStore(path);
  const input = {
    idempotencyKey: 'legacy-drink-by-vintage',
    source: 'receipt' as const,
    items: [{ name: 'Legacy drink by', vintage: true, drinkByDate: '2026-02-31' }]
  };
  const seeded = store.importWines({
    ...input,
    items: [{ name: 'Legacy drink by', vintage: 1 }]
  });
  const legacyPayload = {
    idempotencyKey: input.idempotencyKey,
    source: input.source,
    sourceId: null,
    purchaseDate: null,
    receiptImageUrl: null,
    items: [{
      name: 'Legacy drink by', producer: null, vintage: 1, region: null, country: null, varietal: null,
      price: null, quantity: 1, rating: null, notes: null, store: null, purchaseDate: null,
      drinkByDate: '2026-02-31', location: null, itemKey: null
    }]
  };
  const raw = new Database(path);
  raw.prepare('UPDATE idempotency_keys SET payload_hash = ?, hash_version = NULL WHERE idempotency_key = ?').run(
    hashPayload('importWines', legacyPayload), input.idempotencyKey
  );
  raw.close();
  store.close();
  const reopened = new SqliteCellarStore(path);
  const replay = reopened.importWines(input);
  assert.equal(replay.id, seeded.id);
  assert.equal(reopened.listWines().length, 1);
  reopened.close();
});

test('new idempotency records do not use legacy import hash fallback', () => {
  const store = new SqliteCellarStore(':memory:');
  const input = { idempotencyKey: 'new-format-import', source: 'receipt' as const, items: [{ name: 'Equivalent', quantity: 1 }] };
  const normalized = normalizeBatchImport(input);
  const first = store.importWines(normalized);

  assert.throws(() => store.importWines({ ...input, items: [{ name: 'Equivalent', quantity: null }] }), /different payload/);
  assert.throws(() => store.importWines({ ...input, items: [{ name: ' Equivalent ', quantity: '1' }] }), /different payload/);
  assert.equal(store.listWines().length, 1);
  assert.equal(store.importWines(normalized).id, first.id);
  store.close();
});

test('updating another field preserves an invalid legacy purchase date', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ullage-legacy-date-')), 'cellar.db');
  const initial = new SqliteCellarStore(path);
  const wine = initial.addWine({ name: 'Legacy date', quantity: 2 });
  initial.close();
  const raw = new Database(path);
  raw.prepare('UPDATE wines SET purchase_date = ? WHERE id = ?').run('2026-02-31', wine.id);
  raw.close();
  const reopened = new SqliteCellarStore(path);
  try {
    const updated = reopened.updateWine(wine.id, { notes: 'updated safely' });
    assert.equal(updated?.notes, 'updated safely');
    assert.equal(updated?.purchaseDate, '2026-02-31');
  } finally {
    reopened.close();
  }
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
