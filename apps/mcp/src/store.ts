import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CellarExport, CellarStore, CellarSummary } from './cellar-store.js';
import { initializeSqliteSchema, runIdempotent } from './sqlite-schema.js';
import {
  consumptionToTasting,
  describe,
  hashPayload,
  parseImportRow,
  rowToActivity,
  rowToConsumption,
  rowToHold,
  rowToNote,
  rowToTasting,
  rowToWine,
  stripUndefined,
  truncate,
  wineSelectSql,
  wineToInput,
  type ActivityRow, type ConsumptionRow, type HoldRow, type ImportRow, type NoteRow, type TastingRow, type WineJoinRow
} from './sqlite-rows.js';
import {
  filterTastings,
  filterWines,
  forbiddenAppendOnlyFields,
  normalizeAddWine,
  normalizeBatchImport,
  normalizeIdempotencyKey,
  normalizeQuantity,
  normalizeRecordTasting,
  normalizeTastingQuery,
  optionalDate,
  optionalInt,
  optionalNumber,
  optionalString,
  optionalTimestamp,
  requireText,
  resolveWineByName,
  type ActivityAction, type ActivityEvent, type AddWineInput, type BatchImportInput,
  type BatchImportResult, type ConsumeInput, type ConsumptionEvent, type HoldInput,
  type RecommendationInput, type RecommendationResult, type ReleaseHoldInput,
  type RecordTastingInput, type ResolveWineResult, type Tasting, type TastingNote,
  type TastingQuery, type UpdateConsumptionInput, type Wine, type WineHold, type WriteOptions
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
    // More than one process can hold this cellar open (an MCP transport and an HTTP one).
    // WAL lets readers work during a write, and the busy timeout makes a concurrent writer
    // wait for the lock instead of failing the call outright.
    if (dbPath !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.appendOnly = options.appendOnly === true;
    initializeSqliteSchema(this.db);
  }

  addWine(input: AddWineInput, options: WriteOptions = {}): Wine {
    return this.idempotent('addWine', options.idempotencyKey, input, () => this.insertWine(normalizeAddWine(input), 'add'));
  }

  importWines(input: BatchImportInput): BatchImportResult {
    return this.idempotent('importWines', normalizeIdempotencyKey(input.idempotencyKey), input, () => {
      const normalized = normalizeBatchImport(input);
      const now = new Date().toISOString();
      const wines = normalized.items.map((item) => {
        const { itemKey: _itemKey, ...fields } = item;
        return this.insertWine(fields, 'batch_add', now);
      });
      const result: BatchImportResult = {
        id: randomUUID(), source: normalized.source, sourceId: normalized.sourceId,
        purchaseDate: normalized.purchaseDate, receiptImageUrl: normalized.receiptImageUrl,
        wines, createdAt: now
      };
      this.db.prepare('INSERT INTO batch_imports (id, source, source_id, result_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
        result.id,
        result.source,
        result.sourceId,
        JSON.stringify(result),
        result.createdAt
      );
      this.logActivity('batch_add', null, `Imported ${wines.length} wines from ${normalized.source}`);
      return result;
    }, () => legacyBatchImportPayloads(input));
  }

  listWines(query?: string, inStock?: boolean): Wine[] {
    const wines = (this.db.prepare(`${wineSelectSql()} ORDER BY w.created_at DESC`).all() as WineJoinRow[]).map(rowToWine);
    const filtered = filterWines(wines, query);
    if (inStock === undefined) return filtered;
    return filtered.filter((wine) => (inStock ? wine.quantity > 0 : wine.quantity === 0));
  }

  getWine(id: string): Wine | undefined {
    const row = this.db.prepare(`${wineSelectSql()} WHERE w.id = ?`).get(id) as WineJoinRow | undefined;
    return row ? rowToWine(row) : undefined;
  }

  resolveWine(query: string): ResolveWineResult {
    return resolveWineByName(this.listWines(), query);
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
      const purchaseDateChanged = Object.hasOwn(patch, 'purchaseDate');
      const drinkByDateChanged = Object.hasOwn(patch, 'drinkByDate');
      const f = normalizeAddWine({
        ...wineToInput(existing),
        ...patch,
        ...(purchaseDateChanged ? {} : { purchaseDate: null }),
        ...(drinkByDateChanged ? {} : { drinkByDate: null })
      });
      const storedFields = {
        ...f,
        purchaseDate: purchaseDateChanged ? f.purchaseDate : existing.purchaseDate,
        drinkByDate: drinkByDateChanged ? f.drinkByDate : existing.drinkByDate
      };
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE wines SET name=@name, producer=@producer, vintage=@vintage, region=@region,
             country=@country, varietal=@varietal, price=@price, quantity=@quantity, notes=@notes,
             store=@store, purchase_date=@purchaseDate, drink_by_date=@drinkByDate, location=@location,
             updated_at=@updatedAt WHERE id=@id`
        )
        .run({ ...storedFields, id, updatedAt: now });
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
      const consumedAt = optionalTimestamp(input.consumedAt, 'consumedAt') ?? now;
      this.db.prepare('UPDATE wines SET quantity=?, updated_at=? WHERE id=?').run(existing.quantity - consumed, now, id);
      this.db
        .prepare('INSERT INTO consumption_events (id, wine_id, quantity, rating, notes, consumed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, consumed, rating, notes, consumedAt);
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

  // Fix the rating/notes recorded on a past pour. This edits pour metadata, not wine
  // identity or purchase facts, so it stays allowed in append-only mode.
  updateConsumption(eventId: string, input: UpdateConsumptionInput, options: WriteOptions = {}): ConsumptionEvent {
    return this.idempotent('updateConsumption', options.idempotencyKey, { eventId, input }, () => {
      const row = this.db.prepare('SELECT * FROM consumption_events WHERE id = ?').get(eventId) as ConsumptionRow | undefined;
      if (!row) throw new Error(`No consumption event with id ${eventId}`);
      // An explicit clear flag wins over a value passed in the same call.
      const rating = input.clearRating === true ? null : input.rating !== undefined ? optionalNumber(input.rating) : row.rating;
      const notes = input.clearNotes === true ? null : input.notes !== undefined ? optionalString(input.notes) : row.notes;
      this.db.prepare('UPDATE consumption_events SET rating = ?, notes = ? WHERE id = ?').run(rating, notes, eventId);
      const wine = this.getWine(row.wine_id);
      this.logActivity('consume_update', row.wine_id, `Updated pour of ${wine ? describe(wine) : row.wine_id}${rating !== null ? ` (${rating})` : ''}`);
      return rowToConsumption({ ...row, rating, notes });
    });
  }

  // Record a wine tasted outside the cellar (restaurant, bar, a friend's bottle).
  // Never touches inventory.
  recordTasting(input: RecordTastingInput, options: WriteOptions = {}): Tasting {
    return this.idempotent('recordTasting', options.idempotencyKey, input, () => {
      const f = normalizeRecordTasting(input);
      const tasting: Tasting = { id: randomUUID(), source: 'external', wineId: null, ...f, createdAt: new Date().toISOString() };
      this.db
        .prepare(
          `INSERT INTO tastings (id, wine_name, vintage, producer, region, venue, food_pairing, rating, price, currency, notes, image_url, tasted_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          tasting.id, tasting.wineName, tasting.vintage, tasting.producer, tasting.region, tasting.venue,
          tasting.foodPairing ? JSON.stringify(tasting.foodPairing) : null,
          tasting.rating, tasting.price, tasting.currency, tasting.notes, tasting.imageUrl, tasting.tastedAt, tasting.createdAt
        );
      this.logActivity(
        'tasting',
        null,
        `Tasted ${describe({ name: tasting.wineName, vintage: tasting.vintage })}${tasting.venue ? ` at ${tasting.venue}` : ''}${tasting.rating !== null ? ` (${tasting.rating})` : ''}`
      );
      return tasting;
    });
  }

  // Unified tasting timeline: cellar pours (consumption events) + external tastings.
  listTastings(query: TastingQuery = {}): Tasting[] {
    const normalized = normalizeTastingQuery(query);
    const external = (this.db.prepare('SELECT * FROM tastings').all() as TastingRow[]).map(rowToTasting);
    const wines = new Map(this.listWines().map((wine) => [wine.id, wine]));
    const cellar = (this.db.prepare('SELECT * FROM consumption_events').all() as ConsumptionRow[]).map((row) =>
      consumptionToTasting(row, wines.get(row.wine_id))
    );
    const merged = [...external, ...cellar].sort((left, right) => right.tastedAt.localeCompare(left.tastedAt));
    return filterTastings(merged, normalized);
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
    return this.idempotent('holdWine', input.idempotencyKey, { id, reason: input.reason, until: input.until }, () => {
      const wine = this.getWine(id);
      if (!wine) throw new Error(`No wine with id ${id}`);
      const reason = optionalString(input.reason);
      const until = optionalDate(input.until);
      if (wine.hold) {
        // Re-holding an already-held wine extends/updates it instead of silently ignoring the call.
        if (until === wine.hold.until && (reason === null || reason === wine.hold.reason)) return wine.hold;
        const updated: WineHold = { ...wine.hold, reason: reason ?? wine.hold.reason, until };
        this.db.prepare('UPDATE wine_holds SET reason = ?, until = ? WHERE id = ?').run(updated.reason, updated.until, updated.id);
        this.logActivity('hold', id, `Updated hold on ${describe(wine)}${updated.until ? ` until ${updated.until}` : ''}${updated.reason ? `: ${updated.reason}` : ''}`);
        return updated;
      }
      const hold: WineHold = { id: randomUUID(), wineId: id, reason, until, createdAt: new Date().toISOString(), releasedAt: null };
      this.db.prepare('INSERT INTO wine_holds (id, wine_id, reason, until, created_at, released_at) VALUES (?, ?, ?, ?, ?, ?)').run(hold.id, hold.wineId, hold.reason, hold.until, hold.createdAt, hold.releasedAt);
      this.logActivity('hold', id, `Held ${describe(wine)}${hold.until ? ` until ${hold.until}` : ''}${hold.reason ? `: ${hold.reason}` : ''}`);
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
    const limit = Math.max(1, optionalInt(input.limit, 'limit') ?? 5);
    const includeHeld = input.includeHeld === true;
    const wines = this.listWines().filter((wine) => wine.quantity > 0);
    const available = includeHeld ? wines : wines.filter((wine) => !wine.hold);
    const excludedHeldCount = includeHeld ? 0 : wines.filter((wine) => wine.hold !== undefined && wine.hold !== null).length;
    const occasion = optionalString(input.occasion);
    return {
      recommendations: available.slice(0, limit).map((wine) => ({ wine, reason: occasion ? `Available for ${occasion}` : 'Available and not on hold' })),
      excludedHeldCount
    };
  }

  listActivity(limit = 50): ActivityEvent[] {
    const safe = Math.max(1, optionalInt(limit, 'limit') ?? 50);
    return (this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(safe) as ActivityRow[]).map(rowToActivity);
  }

  summary(): CellarSummary {
    const wines = this.listWines();
    const inStock = wines.filter((wine) => wine.quantity > 0);
    return {
      wine_count: inStock.length,
      bottle_count: inStock.reduce((sum, wine) => sum + wine.quantity, 0),
      consumed_out_count: wines.length - inStock.length,
      recent_wines: inStock.slice(0, 5).map((wine) => ({ id: wine.id, name: wine.name, quantity: wine.quantity, hold: wine.hold ?? null }))
    };
  }

  exportJson(): CellarExport {
    const activity = (this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC').all() as ActivityRow[]).map(rowToActivity);
    const imports = (this.db.prepare('SELECT result_json FROM batch_imports ORDER BY created_at DESC').all() as ImportRow[]).map(parseImportRow);
    const tastings = (this.db.prepare('SELECT * FROM tastings ORDER BY tasted_at DESC').all() as TastingRow[]).map(rowToTasting);
    return { wines: this.listWines(), consumptions: this.listConsumptions(), notes: this.listNotes(), activity, holds: this.allHolds(), imports, tastings };
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

  private idempotent<T>(operation: string, key: string | undefined, payload: unknown, work: () => T, legacyPayloads: () => readonly unknown[] = () => []): T {
    return runIdempotent(this.db, operation, key, payload, work, legacyPayloads);
  }

  private allHolds(): WineHold[] {
    return (this.db.prepare('SELECT * FROM wine_holds ORDER BY created_at DESC').all() as HoldRow[]).map(rowToHold);
  }

  private logActivity(action: ActivityAction, wineId: string | null, summary: string): void {
    this.db.prepare('INSERT INTO activity_log (id, action, wine_id, summary, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), action, wineId, summary, new Date().toISOString());
  }
}

function legacyBatchImportPayloads(input: BatchImportInput): readonly unknown[] {
  try {
    return [normalizeLegacyBatchImport(input)];
  } catch {
    return [];
  }
}

function normalizeLegacyBatchImport(input: BatchImportInput): ReturnType<typeof normalizeBatchImport> {
  const legacyDate = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new Error('invalid legacy date');
    const date = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/)?.[1];
    if (!date) throw new Error('invalid legacy date');
    return date;
  };
  const purchaseDate = legacyDate(input.purchaseDate);
  const items = input.items.map((item) => ({
    ...item,
    purchaseDate: undefined,
    ...(item.quantity === null || item.quantity === '' ? { quantity: undefined } : {})
  }));
  const normalized = normalizeBatchImport({ ...input, purchaseDate: undefined, items });
  return {
    ...normalized,
    purchaseDate,
    items: normalized.items.map((item, index) => ({
      ...item,
      purchaseDate: legacyDate(input.items[index]?.purchaseDate) ?? purchaseDate
    }))
  };
}
