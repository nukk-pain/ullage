import { createHash } from 'node:crypto';
import type { ActivityAction, ActivityEvent, AddWineInput, BatchImportResult, ConsumptionEvent, TastingNote, Wine, WineHold } from '@ullage/domain';

export type WineJoinRow = {
  id: string; name: string; producer: string | null; vintage: number | null; region: string | null;
  country: string | null; varietal: string | null; price: number | null; quantity: number;
  rating: number | null; notes: string | null; store: string | null; purchase_date: string | null;
  drink_by_date: string | null; location: string | null; created_at: string; updated_at: string;
  hold_id: string | null; hold_reason: string | null; hold_created_at: string | null; hold_released_at: string | null;
};
export type ConsumptionRow = { id: string; wine_id: string; quantity: number; rating: number | null; notes: string | null; consumed_at: string };
export type NoteRow = { id: string; wine_id: string; note: string; rating: number | null; created_at: string };
export type ActivityRow = { id: string; action: string; wine_id: string | null; summary: string; created_at: string };
export type HoldRow = { id: string; wine_id: string; reason: string | null; created_at: string; released_at: string | null };
export type IdempotencyRow = { idempotency_key: string; operation: string; payload_hash: string; result_json: string; created_at: string };
export type ImportRow = { result_json: string };

export function wineSelectSql(): string {
  return `SELECT w.*, h.id AS hold_id, h.reason AS hold_reason, h.created_at AS hold_created_at, h.released_at AS hold_released_at
    FROM wines w LEFT JOIN wine_holds h ON h.wine_id = w.id AND h.released_at IS NULL`;
}

export function rowToWine(row: WineJoinRow): Wine {
  return {
    id: row.id, name: row.name, producer: row.producer, vintage: row.vintage, region: row.region,
    country: row.country, varietal: row.varietal, price: row.price, quantity: row.quantity, rating: row.rating,
    notes: row.notes, store: row.store, purchaseDate: row.purchase_date, drinkByDate: row.drink_by_date,
    location: row.location, createdAt: row.created_at, updatedAt: row.updated_at,
    hold: row.hold_id ? { id: row.hold_id, wineId: row.id, reason: row.hold_reason, createdAt: row.hold_created_at ?? row.updated_at, releasedAt: row.hold_released_at } : null
  };
}

export function rowToConsumption(row: ConsumptionRow): ConsumptionEvent {
  return { id: row.id, wineId: row.wine_id, quantity: row.quantity, rating: row.rating, notes: row.notes, consumedAt: row.consumed_at };
}

export function rowToNote(row: NoteRow): TastingNote {
  return { id: row.id, wineId: row.wine_id, note: row.note, rating: row.rating, createdAt: row.created_at };
}

export function rowToActivity(row: ActivityRow): ActivityEvent {
  return { id: row.id, action: row.action as ActivityAction, wineId: row.wine_id, summary: row.summary, createdAt: row.created_at };
}

export function rowToHold(row: HoldRow): WineHold {
  return { id: row.id, wineId: row.wine_id, reason: row.reason, createdAt: row.created_at, releasedAt: row.released_at };
}

export function wineToInput(wine: Wine): AddWineInput {
  return {
    name: wine.name, producer: wine.producer ?? undefined, vintage: wine.vintage ?? undefined,
    region: wine.region ?? undefined, country: wine.country ?? undefined, varietal: wine.varietal ?? undefined,
    price: wine.price ?? undefined, quantity: wine.quantity, notes: wine.notes ?? undefined,
    store: wine.store ?? undefined, purchaseDate: wine.purchaseDate ?? undefined,
    drinkByDate: wine.drinkByDate ?? undefined, location: wine.location ?? undefined
  };
}

export function stripUndefined(input: Partial<AddWineInput>): Partial<AddWineInput> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<AddWineInput>;
}

export function hashPayload(operation: string, payload: unknown): string {
  return createHash('sha256').update(`${operation}:${canonicalJson(payload)}`).digest('hex');
}

export function parseImportRow(row: ImportRow): BatchImportResult {
  return JSON.parse(row.result_json) as BatchImportResult;
}

export function describe(wine: Pick<Wine, 'name' | 'vintage'>): string {
  return [wine.name, wine.vintage].filter(Boolean).join(' ');
}

export function truncate(text: string, limit: number): string {
  const chars = Array.from(text);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : text;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
