import type Database from 'better-sqlite3';
import { hashPayload, type IdempotencyRow } from './sqlite-rows.js';

export function initializeSqliteSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS wines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, producer TEXT, vintage INTEGER,
      region TEXT, country TEXT, varietal TEXT, price REAL, quantity INTEGER NOT NULL DEFAULT 1,
      rating REAL, notes TEXT, store TEXT, purchase_date TEXT, drink_by_date TEXT,
      location TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consumption_events (
      id TEXT PRIMARY KEY, wine_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      rating REAL, notes TEXT, consumed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consumption_wine ON consumption_events(wine_id, consumed_at);
    CREATE TABLE IF NOT EXISTS tasting_notes (
      id TEXT PRIMARY KEY, wine_id TEXT NOT NULL, note TEXT NOT NULL, rating REAL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_wine ON tasting_notes(wine_id, created_at);
    CREATE TABLE IF NOT EXISTS wine_holds (
      id TEXT PRIMARY KEY, wine_id TEXT NOT NULL, reason TEXT, until TEXT, created_at TEXT NOT NULL, released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_holds_active ON wine_holds(wine_id, released_at);
    CREATE TABLE IF NOT EXISTS batch_imports (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL, created_at TEXT NOT NULL, hash_version INTEGER, source_payload_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, wine_id TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at);
    CREATE TABLE IF NOT EXISTS tastings (
      id TEXT PRIMARY KEY, wine_name TEXT NOT NULL, vintage INTEGER, producer TEXT, region TEXT,
      venue TEXT, food_pairing TEXT, rating REAL, price REAL, currency TEXT, notes TEXT, image_url TEXT,
      tasted_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tastings_time ON tastings(tasted_at);
    `);
    migrateSqliteSchema(db);
  }).immediate();
}

// Additive column migrations for databases created by older builds.
// CREATE TABLE IF NOT EXISTS does not add columns to existing tables.
function migrateSqliteSchema(db: Database.Database): void {
  const holdColumns = (db.prepare('PRAGMA table_info(wine_holds)').all() as { name: string }[]).map((c) => c.name);
  if (!holdColumns.includes('until')) db.exec('ALTER TABLE wine_holds ADD COLUMN until TEXT');
  const tastingColumns = (db.prepare('PRAGMA table_info(tastings)').all() as { name: string }[]).map((c) => c.name);
  if (!tastingColumns.includes('image_url')) db.exec('ALTER TABLE tastings ADD COLUMN image_url TEXT');
  const idempotencyColumns = (db.prepare('PRAGMA table_info(idempotency_keys)').all() as { name: string }[]).map((c) => c.name);
  if (!idempotencyColumns.includes('hash_version')) db.exec('ALTER TABLE idempotency_keys ADD COLUMN hash_version INTEGER');
  if (!idempotencyColumns.includes('source_payload_hash')) db.exec('ALTER TABLE idempotency_keys ADD COLUMN source_payload_hash TEXT');
  const duplicateHolds = db.prepare(`UPDATE wine_holds AS older
    SET released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE older.released_at IS NULL AND EXISTS (
      SELECT 1 FROM wine_holds AS newer
      WHERE newer.wine_id = older.wine_id AND newer.released_at IS NULL
        AND (newer.created_at > older.created_at OR (newer.created_at = older.created_at AND newer.id > older.id))
    )`);
  duplicateHolds.run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_holds_active_wine_unique ON wine_holds(wine_id) WHERE released_at IS NULL');

  const legacyImages = db.prepare(`SELECT id, notes FROM tastings
    WHERE image_url IS NULL AND notes LIKE '%Source image: %'`).all() as { id: string; notes: string }[];
  const updateImage = db.prepare('UPDATE tastings SET image_url = ? WHERE id = ? AND image_url IS NULL');
  for (const tasting of legacyImages) {
    const marker = 'Source image: ';
    const suffix = tasting.notes.slice(tasting.notes.indexOf(marker) + marker.length).trim();
    const imageUrl = suffix.split(/\s/u, 1)[0];
    if (imageUrl) updateImage.run(imageUrl, tasting.id);
  }
}

export function runIdempotent<T>(db: Database.Database, operation: string, key: string | undefined, payload: unknown, work: () => T, legacyPayloads: () => readonly unknown[] = () => [], sourcePayload?: unknown): T {
  if (key === undefined || key.trim().length === 0) return db.transaction(work)();
  const payloadHash = hashPayload(operation, payload);
  const sourcePayloadHash = sourcePayload === undefined ? null : hashPayload(operation, sourcePayload);
  const existing = db.prepare('SELECT * FROM idempotency_keys WHERE idempotency_key = ?').get(key) as (IdempotencyRow & { source_payload_hash?: string | null }) | undefined;
  if (existing) {
    if (existing.operation !== operation) {
      throw new Error(`idempotencyKey ${key} was already used with a different payload`);
    }
    if (sourcePayloadHash !== null && existing.source_payload_hash != null) {
      if (existing.source_payload_hash !== sourcePayloadHash) throw new Error(`idempotencyKey ${key} was already used with a different payload`);
      return decodeResult(existing.result_json) as T;
    }
    if (existing.payload_hash !== payloadHash) {
      if (existing.hash_version !== null && existing.hash_version !== undefined) {
        throw new Error(`idempotencyKey ${key} was already used with a different payload`);
      }
      let matchesLegacy = false;
      try {
        matchesLegacy = legacyPayloads().some((legacyPayload) => hashPayload(operation, legacyPayload) === existing.payload_hash);
      } catch {
        throw new Error(`idempotencyKey ${key} was stored by an earlier version and cannot be replayed`);
      }
      if (!matchesLegacy) throw new Error(`idempotencyKey ${key} was already used with a different payload`);
    }
    return decodeResult(existing.result_json) as T;
  }
  return db.transaction(() => {
    const result = work();
    db.prepare('INSERT INTO idempotency_keys (idempotency_key, operation, payload_hash, result_json, created_at, hash_version, source_payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      key,
      operation,
      payloadHash,
      encodeResult(result),
      new Date().toISOString(),
      1,
      sourcePayloadHash
    );
    return result;
  })();
}

export function replayIdempotent(db: Database.Database, operation: string, key: string, payload: unknown): unknown | undefined {
  const existing = db.prepare('SELECT operation, result_json, source_payload_hash FROM idempotency_keys WHERE idempotency_key = ?')
    .get(key) as { operation: string; result_json: string; source_payload_hash: string | null } | undefined;
  if (!existing) return undefined;
  if (existing.operation !== operation) throw new Error(`idempotencyKey ${key} was already used with a different payload`);
  if (existing.source_payload_hash === null) return undefined;
  if (existing.source_payload_hash !== hashPayload(operation, payload)) {
    throw new Error(`idempotencyKey ${key} was already used with a different payload`);
  }
  return decodeResult(existing.result_json);
}

function encodeResult(result: unknown): string {
  return result === undefined ? JSON.stringify({ kind: 'undefined' }) : JSON.stringify({ kind: 'value', result });
}

function decodeResult(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === 'object' && parsed !== null && 'kind' in parsed) {
    const record = parsed as { readonly kind?: unknown; readonly result?: unknown };
    if (record.kind === 'undefined') return undefined;
    if (record.kind === 'value') return record.result;
  }
  return parsed;
}
