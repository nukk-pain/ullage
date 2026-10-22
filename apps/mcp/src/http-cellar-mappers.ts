import { createHash } from 'node:crypto';
import type { ConsumptionEvent, Wine, WineHold } from '@ullage/domain';
import type { JsonObject } from './http-cellar-client.js';

export type HttpConsumptionPage = {
  readonly events: ConsumptionEvent[];
  readonly total: number | null;
};

export function wineListFromJson(value: unknown): Wine[] {
  const object = requireRecord(value, 'HTTP wine list response');
  const wines = object.wines;
  if (!Array.isArray(wines)) throw new Error('HTTP wine list response is missing wines[]');
  return wines.map(wineFromJson);
}

export function wineFromConsumeResponse(value: unknown): Wine {
  const object = requireRecord(value, 'HTTP consume response');
  return wineFromJson(object.sourceWine ?? value);
}

export function wineFromJson(value: unknown): Wine {
  const object = requireRecord(value, 'HTTP wine response');
  const id = requireString(object.id, 'wine.id');
  const hold = holdFromJson(object.hold, id);
  return {
    id,
    name: requireString(object.name, 'wine.name'),
    producer: nullableString(object.producer),
    vintage: nullableInteger(object.vintage),
    region: nullableString(object.region),
    country: nullableString(object.country),
    varietal: nullableString(object.varietal) ?? nullableString(object.grapeVariety),
    price: nullableNumber(object.price),
    quantity: numberOrDefault(object.quantity, 0),
    rating: nullableNumber(object.rating),
    notes: nullableString(object.notes),
    store: nullableString(object.store),
    purchaseDate: nullableString(object.purchaseDate),
    drinkByDate: nullableString(object.drinkByDate),
    location: nullableString(object.location),
    createdAt: requireString(object.createdAt, 'wine.createdAt'),
    updatedAt: requireString(object.updatedAt, 'wine.updatedAt'),
    ...(hold === null ? {} : { hold })
  };
}

function holdFromJson(value: unknown, wineId: string): WineHold | null {
  if (value === undefined || value === null) return null;
  const object = requireRecord(value, 'wine.hold');
  return {
    id: requireString(object.id, 'wine.hold.id'),
    wineId: nullableString(object.wineId) ?? wineId,
    reason: nullableString(object.reason),
    until: nullableString(object.until),
    createdAt: requireString(object.createdAt, 'wine.hold.createdAt'),
    releasedAt: nullableString(object.releasedAt)
  };
}

export function consumptionPageFromJson(value: unknown): HttpConsumptionPage {
  const object = requireRecord(value, 'HTTP consumed wine list response');
  const wines = object.wines;
  if (!Array.isArray(wines)) throw new Error('HTTP consumed wine list response is missing wines[]');
  return { events: wines.map(consumptionFromJson), total: nullableInteger(object.total) };
}

export function putIfPresent(target: JsonObject, key: string, value: unknown): void {
  if (value !== null && value !== undefined) target[key] = value;
}

export function hashPayload(operation: string, payload: unknown): string {
  return createHash('sha256').update(`${operation}:${canonicalJson(payload)}`).digest('hex');
}

export function describeWine(wine: Pick<Wine, 'name' | 'vintage'>): string {
  return [wine.name, wine.vintage].filter(Boolean).join(' ');
}

function consumptionFromJson(value: unknown): ConsumptionEvent {
  const object = requireRecord(value, 'HTTP consumed wine row');
  return {
    id: requireString(object.id, 'consumption.id'),
    wineId: requireString(object.wineId, 'consumption.wineId'),
    quantity: numberOrDefault(object.quantity, 1),
    rating: nullableNumber(object.rating),
    notes: nullableString(object.notes),
    consumedAt: requireString(object.consumedAt, 'consumption.consumedAt')
  };
}

function requireRecord(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`HTTP response is missing ${field}`);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const parsed = nullableInteger(value);
  return parsed === null ? fallback : parsed;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
