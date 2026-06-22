import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CellarExport, CellarStore, CellarSummary } from './cellar-store.js';
import { initializeSqliteSchema, runIdempotent } from './sqlite-schema.js';
import {
  describe,
  parseImportRow,
  rowToActivity,
  rowToConsumption,
  rowToHold,
  rowToNote,
  rowToWine,
  stripUndefined,
  truncate,
  wineSelectSql,
  wineToInput,
  type ActivityRow, type ConsumptionRow, type HoldRow, type ImportRow, type NoteRow, type WineJoinRow
} from './sqlite-rows.js';
import {
  forbiddenAppendOnlyFields,
  normalizeAddWine,
  normalizeBatchImport,
  normalizeQuantity,
  optionalInt,
  optionalNumber,
  optionalString,
  requireText,
  type ActivityAction, type ActivityEvent, type AddWineInput, type BatchImportInput,
  type BatchImportResult, type ConsumeInput, type ConsumptionEvent, type HoldInput,
  type RecommendationInput, type RecommendationResult, type ReleaseHoldInput,
  type TastingNote, type Wine, type WineHold, type WriteOptions
} from '@ullage/domain';

export type SqliteCellarStoreOptions = {
  readonly appendOnly?: boolean;
};

export class SqliteCellarStore implements CellarStore {
  private readonly db: Database.Database;
  private readonly appendOnly: boolean;

  constructor(dbPath: string, options: SqliteCellarStoreOptions = {}) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.appendOnly = options.appendOnly === true;
    initializeSqliteSchema(this.db);
  }

  addWine(input: AddWineInput, options: WriteOptions = {}): Wine {
    return this.idempotent('addWine', options.idempotencyKey, input, () => this.insertWine(normalizeAddWine(input), 'add'));
  }

  importWines(input: BatchImportInput): BatchImportResult {
    const normalized = normalizeBatchImport(input);
    return this.idempotent('importWines', normalized.idempotencyKey, normalized, () => {
      const now = new Date().toISOString();
      const wines = normalized.items.map((item) => {
        const { itemKey: _itemKey, ...fields } = item;
        return this.insertWine(fields, 'batch_add', now);
      });
      const result: BatchImportResult = { id: randomUUID(), source: normalized.source, sourceId: normalized.sourceId, wines, createdAt: now };
      this.db.prepare('INSERT INTO batch_imports (id, source, source_id, result_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
        result.id,
        result.source,
        result.sourceId,
        JSON.stringify(result),
        result.createdAt
      );
      this.logActivity('batch_add', null, `Imported ${wines.length} wines from ${normalized.source}`);
      return result;
    });
  }

  listWines(): Wine[] {
    return (this.db.prepare(`${wineSelectSql()} ORDER BY w.created_at DESC`).all() as WineJoinRow[]).map(rowToWine);
  }

  getWine(id: string): Wine | undefined {
    const row = this.db.prepare(`${wineSelectSql()} WHERE w.id = ?`).get(id) as WineJoinRow | undefined;
    return row ? rowToWine(row) : undefined;
  }

  updateWine(id: string, input: Partial<AddWineInput>, options: WriteOptions = {}): Wine | undefined {
    return this.idempotent('updateWine', options.idempotencyKey, { id, input }, () => {
      const existing = this.getWine(id);
      if (!existing) return undefined;
      const patch = stripUndefined(input);
      const changed = Object.keys(patch);
      if (this.appendOnly && changed.length > 0) {
        const forbidden = forbiddenAppendOnlyFields(patch);
        throw new Error(`append-only mode rejects update_wine; record consume, hold, release, or note events instead${forbidden.length ? `: ${forbidden.join(', ')}` : ''}`);
      }
      const f = normalizeAddWine({ ...wineToInput(existing), ...patch });
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE wines SET name=@name, producer=@producer, vintage=@vintage, region=@region,
             country=@country, varietal=@varietal, price=@price, quantity=@quantity, notes=@notes,
             store=@store, purchase_date=@purchaseDate, drink_by_date=@drinkByDate, location=@location,
             updated_at=@updatedAt WHERE id=@id`
        )
        .run({ ...f, id, updatedAt: now });
      this.logActivity('update', id, `Updated ${describe({ ...existing, ...f })}: ${changed.join(', ') || 'no fields'}`);
      return this.getWine(id);
    });
  }

  consumeWine(id: string, input: ConsumeInput, options: WriteOptions = {}): Wine | undefined {
    return this.idempotent('consumeWine', options.idempotencyKey, { id, input }, () => {
      const existing = this.getWine(id);
      if (!existing) return undefined;
      if (existing.hold) throw new Error(`${describe(existing)} is on hold; release it before consuming`);
      const requested = normalizeQuantity(input.quantity, 1);
      const consumed = Math.min(requested, existing.quantity);
      if (consumed <= 0) throw new Error(`No bottles of ${describe(existing)} left to open`);
      const rating = optionalNumber(input.rating);
      const notes = optionalString(input.notes);
      const now = new Date().toISOString();
      this.db.prepare('UPDATE wines SET quantity=?, updated_at=? WHERE id=?').run(existing.quantity - consumed, now, id);
      this.db
        .prepare('INSERT INTO consumption_events (id, wine_id, quantity, rating, notes, consumed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, consumed, rating, notes, now);
      this.logActivity('consume', id, `Opened ${consumed} of ${describe(existing)}${rating !== null ? ` (${rating})` : ''}`);
      return this.getWine(id);
    });
  }

  listConsumptions(wineId?: string): ConsumptionEvent[] {
    const rows = wineId
      ? this.db.prepare('SELECT * FROM consumption_events WHERE wine_id = ? ORDER BY consumed_at DESC').all(wineId)
      : this.db.prepare('SELECT * FROM consumption_events ORDER BY consumed_at DESC').all();
    return (rows as ConsumptionRow[]).map(rowToConsumption);
  }

  addNote(wineId: string, note: unknown, rating?: unknown, options: WriteOptions = {}): TastingNote {
    return this.idempotent('addNote', options.idempotencyKey, { wineId, note, rating }, () => {
      const wine = this.getWine(wineId);
      if (!wine) throw new Error(`No wine with id ${wineId}`);
      const event: TastingNote = { id: randomUUID(), wineId, note: requireText(note, 'note'), rating: optionalNumber(rating), createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO tasting_notes (id, wine_id, note, rating, created_at) VALUES (?, ?, ?, ?, ?)').run(event.id, event.wineId, event.note, event.rating, event.createdAt);
      this.logActivity('note', wineId, `Note on ${describe(wine)}: ${truncate(event.note, 60)}`);
      return event;
    });
  }

  listNotes(wineId?: string): TastingNote[] {
    const rows = wineId
      ? this.db.prepare('SELECT * FROM tasting_notes WHERE wine_id = ? ORDER BY created_at DESC').all(wineId)
      : this.db.prepare('SELECT * FROM tasting_notes ORDER BY created_at DESC').all();
    return (rows as NoteRow[]).map(rowToNote);
  }

  holdWine(id: string, input: HoldInput): WineHold {
    return this.idempotent('holdWine', input.idempotencyKey, { id, reason: input.reason }, () => {
      const wine = this.getWine(id);
      if (!wine) throw new Error(`No wine with id ${id}`);
      if (wine.hold) return wine.hold;
      const hold: WineHold = { id: randomUUID(), wineId: id, reason: optionalString(input.reason), createdAt: new Date().toISOString(), releasedAt: null };
      this.db.prepare('INSERT INTO wine_holds (id, wine_id, reason, created_at, released_at) VALUES (?, ?, ?, ?, ?)').run(hold.id, hold.wineId, hold.reason, hold.createdAt, hold.releasedAt);
      this.logActivity('hold', id, `Held ${describe(wine)}${hold.reason ? `: ${hold.reason}` : ''}`);
      return hold;
    });
  }

  releaseHold(id: string, input: ReleaseHoldInput): WineHold {
    return this.idempotent('releaseHold', input.idempotencyKey, { id }, () => {
      const wine = this.getWine(id);
      if (!wine) throw new Error(`No wine with id ${id}`);
      if (!wine.hold) throw new Error(`No active hold for wine ${id}`);
      const released: WineHold = { ...wine.hold, releasedAt: new Date().toISOString() };
      this.db.prepare('UPDATE wine_holds SET released_at = ? WHERE id = ?').run(released.releasedAt, released.id);
      this.logActivity('release', id, `Released hold on ${describe(wine)}`);
      return released;
    });
  }

  listHolds(): WineHold[] {
    return (this.db.prepare('SELECT * FROM wine_holds WHERE released_at IS NULL ORDER BY created_at DESC').all() as HoldRow[]).map(rowToHold);
  }

  recommendWines(input: RecommendationInput): RecommendationResult {
    const limit = Math.max(1, optionalInt(input.limit) ?? 5);
    const includeHeld = input.includeHeld === true;
    const wines = this.listWines().filter((wine) => wine.quantity > 0);
    const available = includeHeld ? wines : wines.filter((wine) => !wine.hold);
    const excludedHeld = includeHeld ? [] : wines.filter((wine) => wine.hold !== undefined && wine.hold !== null);
    const occasion = optionalString(input.occasion);
    return {
      recommendations: available.slice(0, limit).map((wine) => ({ wine, reason: occasion ? `Available for ${occasion}` : 'Available and not on hold' })),
      excludedHeld
    };
  }

  listActivity(limit = 50): ActivityEvent[] {
    const safe = Math.max(1, optionalInt(limit) ?? 50);
    return (this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(safe) as ActivityRow[]).map(rowToActivity);
  }

  summary(): CellarSummary {
    const wines = this.listWines();
    return {
      wine_count: wines.length,
      bottle_count: wines.reduce((sum, wine) => sum + wine.quantity, 0),
      recent_wines: wines.slice(0, 5).map((wine) => ({ id: wine.id, name: wine.name, quantity: wine.quantity, hold: wine.hold ?? null }))
    };
  }

  exportJson(): CellarExport {
    const activity = (this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC').all() as ActivityRow[]).map(rowToActivity);
    const imports = (this.db.prepare('SELECT result_json FROM batch_imports ORDER BY created_at DESC').all() as ImportRow[]).map(parseImportRow);
    return { wines: this.listWines(), consumptions: this.listConsumptions(), notes: this.listNotes(), activity, holds: this.allHolds(), imports };
  }

  close(): void {
    this.db.close();
  }

  private insertWine(f: ReturnType<typeof normalizeAddWine>, action: Extract<ActivityAction, 'add' | 'batch_add'>, now = new Date().toISOString()): Wine {
    const wine: Wine = { id: randomUUID(), ...f, createdAt: now, updatedAt: now, hold: null };
    this.db
      .prepare(
        `INSERT INTO wines (id, name, producer, vintage, region, country, varietal, price, quantity,
           rating, notes, store, purchase_date, drink_by_date, location, created_at, updated_at)
         VALUES (@id, @name, @producer, @vintage, @region, @country, @varietal, @price, @quantity,
           @rating, @notes, @store, @purchaseDate, @drinkByDate, @location, @createdAt, @updatedAt)`
      )
      .run(wine);
    if (action === 'add') this.logActivity('add', wine.id, `Added ${describe(wine)} x${wine.quantity}`);
    return wine;
  }

  private idempotent<T>(operation: string, key: string | undefined, payload: unknown, work: () => T): T {
    return runIdempotent(this.db, operation, key, payload, work);
  }

  private allHolds(): WineHold[] {
    return (this.db.prepare('SELECT * FROM wine_holds ORDER BY created_at DESC').all() as HoldRow[]).map(rowToHold);
  }

  private logActivity(action: ActivityAction, wineId: string | null, summary: string): void {
    this.db.prepare('INSERT INTO activity_log (id, action, wine_id, summary, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), action, wineId, summary, new Date().toISOString());
  }
}
