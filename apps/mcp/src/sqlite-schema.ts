import type Database from 'better-sqlite3';
import { hashPayload, type IdempotencyRow } from './sqlite-rows.js';

export function initializeSqliteSchema(db: Database.Database): void {
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
      id TEXT PRIMARY KEY, wine_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_holds_active ON wine_holds(wine_id, released_at);
    CREATE TABLE IF NOT EXISTS batch_imports (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, wine_id TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at);
  `);
}

export function runIdempotent<T>(db: Database.Database, operation: string, key: string | undefined, payload: unknown, work: () => T): T {
  if (key === undefined || key.trim().length === 0) return db.transaction(work)();
  const payloadHash = hashPayload(operation, payload);
  const existing = db.prepare('SELECT * FROM idempotency_keys WHERE idempotency_key = ?').get(key) as IdempotencyRow | undefined;
  if (existing) {
    if (existing.operation !== operation || existing.payload_hash !== payloadHash) throw new Error(`idempotencyKey ${key} was already used with a different payload`);
    return decodeResult(existing.result_json) as T;
  }
  return db.transaction(() => {
    const result = work();
    db.prepare('INSERT INTO idempotency_keys (idempotency_key, operation, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      key,
      operation,
      payloadHash,
      encodeResult(result),
      new Date().toISOString()
    );
    return result;
  })();
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
