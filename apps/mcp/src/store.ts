import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  normalizeAddWine,
  normalizeQuantity,
  optionalNumber,
  optionalString,
  requireText,
  type ActivityAction,
  type ActivityEvent,
  type AddWineInput,
  type ConsumeInput,
  type ConsumptionEvent,
  type TastingNote,
  type Wine
} from '@ullage/domain';

// Local, single-user cellar backed by SQLite. No server, no token — the file is the cellar.
export class SqliteCellarStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        producer TEXT,
        vintage INTEGER,
        region TEXT,
        country TEXT,
        varietal TEXT,
        price REAL,
        quantity INTEGER NOT NULL DEFAULT 1,
        rating REAL,
        notes TEXT,
        store TEXT,
        purchase_date TEXT,
        drink_by_date TEXT,
        location TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS consumption_events (
        id TEXT PRIMARY KEY,
        wine_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        rating REAL,
        notes TEXT,
        consumed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consumption_wine ON consumption_events(wine_id, consumed_at);
      CREATE TABLE IF NOT EXISTS tasting_notes (
        id TEXT PRIMARY KEY,
        wine_id TEXT NOT NULL,
        note TEXT NOT NULL,
        rating REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_wine ON tasting_notes(wine_id, created_at);
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        wine_id TEXT,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at);
    `);
  }

  addWine(input: AddWineInput): Wine {
    const f = normalizeAddWine(input);
    const now = new Date().toISOString();
    const wine: Wine = { id: randomUUID(), ...f, createdAt: now, updatedAt: now };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO wines (id, name, producer, vintage, region, country, varietal, price, quantity,
             rating, notes, store, purchase_date, drink_by_date, location, created_at, updated_at)
           VALUES (@id, @name, @producer, @vintage, @region, @country, @varietal, @price, @quantity,
             @rating, @notes, @store, @purchaseDate, @drinkByDate, @location, @createdAt, @updatedAt)`
        )
        .run(wine);
      this.logActivity('add', wine.id, `Added ${describe(wine)} x${wine.quantity}`);
    })();
    return wine;
  }

  listWines(): Wine[] {
    return (this.db.prepare('SELECT * FROM wines ORDER BY created_at DESC').all() as WineRow[]).map(rowToWine);
  }

  getWine(id: string): Wine | undefined {
    const row = this.db.prepare('SELECT * FROM wines WHERE id = ?').get(id) as WineRow | undefined;
    return row ? rowToWine(row) : undefined;
  }

  updateWine(id: string, input: Partial<AddWineInput>): Wine | undefined {
    const existing = this.getWine(id);
    if (!existing) return undefined;
    const patch = stripUndefined(input);
    const changed = Object.keys(patch);
    const f = normalizeAddWine({ ...wineToInput(existing), ...patch });
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE wines SET name=@name, producer=@producer, vintage=@vintage, region=@region,
             country=@country, varietal=@varietal, price=@price, quantity=@quantity, notes=@notes,
             store=@store, purchase_date=@purchaseDate, drink_by_date=@drinkByDate, location=@location,
             updated_at=@updatedAt WHERE id=@id`
        )
        .run({ ...f, id, updatedAt: now });
      this.logActivity('update', id, `Updated ${describe({ ...existing, ...f })}: ${changed.join(', ') || 'no fields'}`);
    })();
    return this.getWine(id);
  }

  // Consume bottles: log the actual amount taken (never more than on hand), with the per-pour
  // rating/notes recorded on the consumption event — the wine's own rating/notes are not touched
  // (use update_wine / add_note for those).
  consumeWine(id: string, input: ConsumeInput): Wine | undefined {
    const existing = this.getWine(id);
    if (!existing) return undefined;
    const requested = normalizeQuantity(input.quantity, 1);
    const consumed = Math.min(requested, existing.quantity);
    if (consumed <= 0) throw new Error(`No bottles of ${describe(existing)} left to open`);
    const rating = optionalNumber(input.rating);
    const notes = optionalString(input.notes);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('UPDATE wines SET quantity=?, updated_at=? WHERE id=?').run(existing.quantity - consumed, now, id);
      this.db
        .prepare('INSERT INTO consumption_events (id, wine_id, quantity, rating, notes, consumed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, consumed, rating, notes, now);
      this.logActivity('consume', id, `Opened ${consumed} of ${describe(existing)}${rating !== null ? ` (${rating})` : ''}`);
    })();
    return this.getWine(id);
  }

  listConsumptions(wineId?: string): ConsumptionEvent[] {
    const rows = wineId
      ? this.db.prepare('SELECT * FROM consumption_events WHERE wine_id = ? ORDER BY consumed_at DESC').all(wineId)
      : this.db.prepare('SELECT * FROM consumption_events ORDER BY consumed_at DESC').all();
    return (rows as ConsumptionRow[]).map(rowToConsumption);
  }

  addNote(wineId: string, note: unknown, rating?: unknown): TastingNote {
    const wine = this.getWine(wineId);
    if (!wine) throw new Error(`No wine with id ${wineId}`);
    const event: TastingNote = {
      id: randomUUID(),
      wineId,
      note: requireText(note, 'note'),
      rating: optionalNumber(rating),
      createdAt: new Date().toISOString()
    };
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO tasting_notes (id, wine_id, note, rating, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(event.id, event.wineId, event.note, event.rating, event.createdAt);
      this.logActivity('note', wineId, `Note on ${describe(wine)}: ${truncate(event.note, 60)}`);
    })();
    return event;
  }

  listNotes(wineId?: string): TastingNote[] {
    const rows = wineId
      ? this.db.prepare('SELECT * FROM tasting_notes WHERE wine_id = ? ORDER BY created_at DESC').all(wineId)
      : this.db.prepare('SELECT * FROM tasting_notes ORDER BY created_at DESC').all();
    return (rows as NoteRow[]).map(rowToNote);
  }

  listActivity(limit = 50): ActivityEvent[] {
    const n = Math.trunc(Number(limit));
    const safe = Number.isFinite(n) && n > 0 ? n : 50;
    return (this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(safe) as ActivityRow[]).map(rowToActivity);
  }

  summary(): { wine_count: number; bottle_count: number; recent_wines: Array<{ id: string; name: string; quantity: number }> } {
    const wines = this.listWines();
    return {
      wine_count: wines.length,
      bottle_count: wines.reduce((sum, w) => sum + w.quantity, 0),
      recent_wines: wines.slice(0, 5).map((w) => ({ id: w.id, name: w.name, quantity: w.quantity }))
    };
  }

  // Full, unbounded export for backup / data ownership.
  exportJson(): { wines: Wine[]; consumptions: ConsumptionEvent[]; notes: TastingNote[]; activity: ActivityEvent[] } {
    const activity = (this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC').all() as ActivityRow[]).map(rowToActivity);
    return { wines: this.listWines(), consumptions: this.listConsumptions(), notes: this.listNotes(), activity };
  }

  private logActivity(action: ActivityAction, wineId: string | null, summary: string): void {
    this.db
      .prepare('INSERT INTO activity_log (id, action, wine_id, summary, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), action, wineId, summary, new Date().toISOString());
  }
}

type WineRow = {
  id: string; name: string; producer: string | null; vintage: number | null; region: string | null;
  country: string | null; varietal: string | null; price: number | null; quantity: number;
  rating: number | null; notes: string | null; store: string | null; purchase_date: string | null;
  drink_by_date: string | null; location: string | null; created_at: string; updated_at: string;
};
type ConsumptionRow = { id: string; wine_id: string; quantity: number; rating: number | null; notes: string | null; consumed_at: string };
type NoteRow = { id: string; wine_id: string; note: string; rating: number | null; created_at: string };
type ActivityRow = { id: string; action: string; wine_id: string | null; summary: string; created_at: string };

function rowToWine(r: WineRow): Wine {
  return {
    id: r.id, name: r.name, producer: r.producer, vintage: r.vintage, region: r.region,
    country: r.country, varietal: r.varietal, price: r.price, quantity: r.quantity, rating: r.rating,
    notes: r.notes, store: r.store, purchaseDate: r.purchase_date, drinkByDate: r.drink_by_date,
    location: r.location, createdAt: r.created_at, updatedAt: r.updated_at
  };
}
function rowToConsumption(r: ConsumptionRow): ConsumptionEvent {
  return { id: r.id, wineId: r.wine_id, quantity: r.quantity, rating: r.rating, notes: r.notes, consumedAt: r.consumed_at };
}
function rowToNote(r: NoteRow): TastingNote {
  return { id: r.id, wineId: r.wine_id, note: r.note, rating: r.rating, createdAt: r.created_at };
}
function rowToActivity(r: ActivityRow): ActivityEvent {
  return { id: r.id, action: r.action as ActivityAction, wineId: r.wine_id, summary: r.summary, createdAt: r.created_at };
}

function wineToInput(w: Wine): AddWineInput {
  return {
    name: w.name, producer: w.producer ?? undefined, vintage: w.vintage ?? undefined,
    region: w.region ?? undefined, country: w.country ?? undefined, varietal: w.varietal ?? undefined,
    price: w.price ?? undefined, quantity: w.quantity, notes: w.notes ?? undefined,
    store: w.store ?? undefined, purchaseDate: w.purchaseDate ?? undefined,
    drinkByDate: w.drinkByDate ?? undefined, location: w.location ?? undefined
  };
}
function stripUndefined(input: Partial<AddWineInput>): Partial<AddWineInput> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<AddWineInput>;
}
function describe(w: Pick<Wine, 'name' | 'vintage'>): string {
  return [w.name, w.vintage].filter(Boolean).join(' ');
}
function truncate(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : s;
}
