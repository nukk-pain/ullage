// Wine cellar domain: types + validation/normalization shared by storage drivers.

export type Wine = {
  id: string;
  name: string;
  producer: string | null;
  vintage: number | null;
  region: string | null;
  country: string | null;
  varietal: string | null;
  price: number | null;
  quantity: number;
  rating: number | null;
  notes: string | null;
  store: string | null;
  purchaseDate: string | null;
  drinkByDate: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConsumptionEvent = {
  id: string;
  wineId: string;
  quantity: number;
  rating: number | null;
  notes: string | null;
  consumedAt: string;
};

export type AddWineInput = {
  name: string;
  producer?: unknown;
  vintage?: unknown;
  region?: unknown;
  country?: unknown;
  varietal?: unknown;
  price?: unknown;
  quantity?: unknown;
  notes?: unknown;
  store?: unknown;
  purchaseDate?: unknown;
  drinkByDate?: unknown;
  location?: unknown;
};

export type ConsumeInput = {
  quantity?: unknown;
  rating?: unknown;
  notes?: unknown;
};

// A tasting note recorded about a wine at a point in time (without necessarily opening it).
export type TastingNote = {
  id: string;
  wineId: string;
  note: string;
  rating: number | null;
  createdAt: string;
};

// A cellar activity-log entry: every change to the cellar, as a one-line summary.
export type ActivityAction = 'add' | 'update' | 'consume' | 'note';
export type ActivityEvent = {
  id: string;
  action: ActivityAction;
  wineId: string | null;
  summary: string;
  createdAt: string;
};

export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

// The normalized column values for a new wine (no id/timestamps).
export type NormalizedWineFields = Omit<Wine, 'id' | 'createdAt' | 'updatedAt'>;

export function requireName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('name is required');
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function optionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Accept YYYY-MM-DD (or anything Date can parse) and normalize to YYYY-MM-DD; else null.
export function optionalDate(value: unknown): string | null {
  const s = optionalString(value);
  if (!s) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function normalizeQuantity(value: unknown, fallback = 1): number {
  const n = optionalInt(value);
  return n === null ? fallback : Math.max(0, n);
}

// Validate + normalize an add_wine payload into column values.
export function normalizeAddWine(input: AddWineInput): NormalizedWineFields {
  return {
    name: requireName(input.name),
    producer: optionalString(input.producer),
    vintage: optionalInt(input.vintage),
    region: optionalString(input.region),
    country: optionalString(input.country),
    varietal: optionalString(input.varietal),
    price: optionalNumber(input.price),
    quantity: normalizeQuantity(input.quantity, 1),
    rating: null,
    notes: optionalString(input.notes),
    store: optionalString(input.store),
    purchaseDate: optionalDate(input.purchaseDate),
    drinkByDate: optionalDate(input.drinkByDate),
    location: optionalString(input.location)
  };
}
