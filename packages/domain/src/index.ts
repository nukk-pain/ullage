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
  hold?: WineHold | null;
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

export type WineHold = {
  id: string;
  wineId: string;
  reason: string | null;
  createdAt: string;
  releasedAt: string | null;
};

export type BatchImportSource = 'receipt' | 'label_photo' | 'manual_batch';

export type BatchImportItemInput = AddWineInput & {
  readonly itemKey?: unknown;
  readonly kind?: unknown;
};

export type BatchImportInput = {
  readonly idempotencyKey: unknown;
  readonly source: BatchImportSource;
  readonly sourceId?: unknown;
  readonly items: readonly BatchImportItemInput[];
};

export type NormalizedBatchImportItem = NormalizedWineFields & {
  readonly itemKey: string | null;
};

export type NormalizedBatchImport = {
  readonly idempotencyKey: string;
  readonly source: BatchImportSource;
  readonly sourceId: string | null;
  readonly items: readonly NormalizedBatchImportItem[];
};

export type BatchImportResult = {
  readonly id: string;
  readonly source: BatchImportSource;
  readonly sourceId: string | null;
  readonly wines: readonly Wine[];
  readonly createdAt: string;
};

export type WriteOptions = {
  readonly idempotencyKey?: string;
};

export type HoldInput = WriteOptions & {
  readonly reason?: unknown;
};

export type ReleaseHoldInput = WriteOptions;

export type RecommendationInput = {
  readonly occasion?: unknown;
  readonly limit?: unknown;
  readonly includeHeld?: unknown;
};

export type WineRecommendation = {
  readonly wine: Wine;
  readonly reason: string;
};

export type RecommendationResult = {
  readonly recommendations: readonly WineRecommendation[];
  readonly excludedHeld: readonly Wine[];
};

// A cellar activity-log entry: every change to the cellar, as a one-line summary.
export type ActivityAction = 'add' | 'update' | 'consume' | 'note' | 'batch_add' | 'hold' | 'release';
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

export type NormalizedWineFields = Omit<Wine, 'id' | 'createdAt' | 'updatedAt' | 'hold'>;

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

export function normalizeIdempotencyKey(value: unknown): string {
  return requireText(value, 'idempotencyKey');
}

export function normalizeBatchImport(input: BatchImportInput): NormalizedBatchImport {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('items must include at least one wine row');
  const seen = new Set<string>();
  const items = input.items.map((item, index) => {
    if (item.kind === 'non_wine') throw new Error(`non-wine receipt row at index ${index}`);
    const itemKey = optionalString(item.itemKey);
    if (itemKey !== null) {
      if (seen.has(itemKey)) throw new Error(`duplicate itemKey ${itemKey}`);
      seen.add(itemKey);
    }
    return { ...normalizeAddWine(item), itemKey };
  });
  return {
    idempotencyKey,
    source: input.source,
    sourceId: optionalString(input.sourceId),
    items
  };
}

const APPEND_ONLY_FORBIDDEN_FIELDS = new Set<keyof AddWineInput>([
  'name',
  'producer',
  'vintage',
  'region',
  'country',
  'varietal',
  'price',
  'store',
  'purchaseDate',
  'drinkByDate',
  'location'
]);

export function forbiddenAppendOnlyFields(input: Partial<AddWineInput>): string[] {
  return Object.keys(input).filter((key) => APPEND_ONLY_FORBIDDEN_FIELDS.has(key as keyof AddWineInput)).sort();
}
