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
  consumedAt?: unknown; // when the bottle was opened; defaults to now
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
  until: string | null; // YYYY-MM-DD the hold is meant to last to; informational, never auto-released
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
  readonly purchaseDate?: unknown; // batch-level YYYY-MM-DD; fills items that lack their own
  readonly receiptImageUrl?: unknown;
  readonly items: readonly BatchImportItemInput[];
};

export type NormalizedBatchImportItem = NormalizedWineFields & {
  readonly itemKey: string | null;
};

export type NormalizedBatchImport = {
  readonly idempotencyKey: string;
  readonly source: BatchImportSource;
  readonly sourceId: string | null;
  readonly purchaseDate: string | null;
  readonly receiptImageUrl: string | null;
  readonly items: readonly NormalizedBatchImportItem[];
};

export type BatchImportResult = {
  readonly id: string;
  readonly source: BatchImportSource;
  readonly sourceId: string | null;
  readonly purchaseDate: string | null;
  readonly receiptImageUrl: string | null;
  readonly wines: readonly Wine[];
  readonly createdAt: string;
};

export type WriteOptions = {
  readonly idempotencyKey?: string;
};

export type HoldInput = WriteOptions & {
  readonly reason?: unknown;
  readonly until?: unknown; // YYYY-MM-DD
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
  readonly excludedHeldCount: number;
};

// A tasting: a wine actually drunk, in the cellar (a bottle opened) or outside it
// (a glass at a restaurant, a friend's bottle). External tastings never touch inventory.
export type TastingSource = 'cellar' | 'external';

export type Tasting = {
  id: string;
  source: TastingSource;
  wineId: string | null; // cellar wine id when source === 'cellar'
  wineName: string;
  vintage: number | null;
  producer: string | null;
  region: string | null;
  venue: string | null; // where it was tasted, for external tastings
  foodPairing: readonly string[] | null;
  rating: number | null;
  price: number | null;
  currency: string | null;
  notes: string | null;
  imageUrl: string | null;
  tastedAt: string;
  createdAt: string;
};

export type RecordTastingInput = {
  name: unknown;
  tastedAt: unknown;
  vintage?: unknown;
  producer?: unknown;
  region?: unknown;
  venue?: unknown;
  foodPairing?: unknown;
  rating?: unknown;
  price?: unknown;
  currency?: unknown;
  notes?: unknown;
  imageUrl?: unknown;
};

export type NormalizedTastingFields = Omit<Tasting, 'id' | 'source' | 'wineId' | 'createdAt'>;

export type TastingQuery = {
  source?: unknown;
  query?: unknown;
  minRating?: unknown;
  venue?: unknown;
  limit?: unknown;
  offset?: unknown;
};

export type NormalizedTastingQuery = {
  readonly source: TastingSource | null;
  readonly query: string | null;
  readonly minRating: number | null;
  readonly venue: string | null;
  readonly limit: number;
  readonly offset: number;
};

export type UpdateConsumptionInput = {
  rating?: unknown;
  notes?: unknown;
  clearRating?: unknown;
  clearNotes?: unknown;
};

export type ResolveWineResult =
  | { readonly status: 'resolved'; readonly matchKind: 'exact' | 'single_candidate'; readonly wine: Wine }
  | { readonly status: 'ambiguous'; readonly query: string; readonly candidates: readonly Wine[] }
  | { readonly status: 'none'; readonly query: string };

// A cellar activity-log entry: every change to the cellar, as a one-line summary.
export type ActivityAction = 'add' | 'update' | 'consume' | 'note' | 'batch_add' | 'hold' | 'release' | 'tasting' | 'consume_update';
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
  if (!Number.isSafeInteger(parsed)) throw new Error('value must be a safe integer');
  return parsed;
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
  if (value === undefined) return fallback;
  let n: number | null;
  try {
    n = optionalInt(value);
  } catch (error) {
    if (error instanceof Error) throw new Error('quantity must be a non-negative safe integer', { cause: error });
    throw error;
  }
  if (n === null || n < 0) throw new Error('quantity must be a non-negative safe integer');
  return n;
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
  const purchaseDate = optionalDate(input.purchaseDate);
  const seen = new Set<string>();
  const items = input.items.map((item, index) => {
    if (item.kind === 'non_wine') throw new Error(`non-wine receipt row at index ${index}`);
    const itemKey = optionalString(item.itemKey);
    if (itemKey !== null) {
      if (seen.has(itemKey)) throw new Error(`duplicate itemKey ${itemKey}`);
      seen.add(itemKey);
    }
    const fields = normalizeAddWine(item);
    // The batch-level purchase date fills items that do not carry their own.
    return { ...fields, purchaseDate: fields.purchaseDate ?? purchaseDate, itemKey };
  });
  return {
    idempotencyKey,
    source: input.source,
    sourceId: optionalString(input.sourceId),
    purchaseDate,
    receiptImageUrl: optionalString(input.receiptImageUrl),
    items
  };
}

// Accept YYYY-MM-DD (expanded to midnight UTC, matching how bare dates are spoken)
// or a full ISO8601 timestamp. An explicit but unparseable value throws rather than
// silently becoming "now".
export function optionalTimestamp(value: unknown, field: string): string | null {
  const s = optionalString(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be YYYY-MM-DD or an ISO8601 timestamp`);
  return parsed.toISOString();
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

function optionalStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(optionalString).filter((item): item is string => item !== null);
  return items.length > 0 ? items : null;
}

// Validate + normalize a record_tasting payload. tastedAt is required so the
// unified timeline stays sortable; the agent should ask the user for the date.
export function normalizeRecordTasting(input: RecordTastingInput): NormalizedTastingFields {
  const tastedAt = optionalDate(input.tastedAt);
  if (!tastedAt) throw new Error('tastedAt is required (YYYY-MM-DD)');
  return {
    wineName: requireName(input.name),
    vintage: optionalInt(input.vintage),
    producer: optionalString(input.producer),
    region: optionalString(input.region),
    venue: optionalString(input.venue),
    foodPairing: optionalStringArray(input.foodPairing),
    rating: optionalNumber(input.rating),
    price: optionalNumber(input.price),
    currency: optionalString(input.currency),
    notes: optionalString(input.notes),
    imageUrl: optionalString(input.imageUrl),
    tastedAt
  };
}

export function normalizeTastingQuery(input: TastingQuery = {}): NormalizedTastingQuery {
  const source = optionalString(input.source);
  if (source !== null && source !== 'cellar' && source !== 'external') {
    throw new Error(`source must be "cellar" or "external", got "${source}"`);
  }
  return {
    source,
    query: optionalString(input.query),
    minRating: optionalNumber(input.minRating),
    venue: optionalString(input.venue),
    limit: Math.max(1, optionalInt(input.limit) ?? 50),
    offset: Math.max(0, optionalInt(input.offset) ?? 0)
  };
}

function normalizeMatchText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim().replace(/\s+/g, ' ') : '';
}

// Case-insensitive substring filter shared by every storage driver.
export function filterTastings(tastings: readonly Tasting[], query: NormalizedTastingQuery): Tasting[] {
  const needle = normalizeMatchText(query.query);
  const venueNeedle = normalizeMatchText(query.venue);
  return tastings
    .filter((tasting) => {
      if (query.source !== null && tasting.source !== query.source) return false;
      if (query.minRating !== null && (tasting.rating === null || tasting.rating < query.minRating)) return false;
      if (venueNeedle && !normalizeMatchText(tasting.venue).includes(venueNeedle)) return false;
      if (needle) {
        const haystack = [tasting.wineName, tasting.producer, tasting.region, tasting.venue, tasting.notes]
          .map(normalizeMatchText)
          .join(' ');
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .slice(query.offset, query.offset + query.limit);
}

// Case-insensitive substring search across the fields people actually remember.
export function filterWines(wines: readonly Wine[], query: unknown): Wine[] {
  const needle = normalizeMatchText(query);
  if (!needle) return [...wines];
  return wines.filter((wine) =>
    [wine.name, wine.producer, wine.region, wine.varietal, wine.country].map(normalizeMatchText).join(' ').includes(needle)
  );
}

const RESOLVE_CANDIDATE_LIMIT = 8;

// Resolve a natural-language wine name to one cellar wine, or say why we cannot:
// exact-name match wins; a lone fuzzy candidate resolves; several candidates are
// returned for the agent to disambiguate with the user; a trailing vintage
// ("Barolo 2016") is split and retried before giving up. In-stock wines rank first.
export function resolveWineByName(wines: readonly Wine[], rawQuery: unknown): ResolveWineResult {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) return { status: 'none', query };

  let effectiveQuery = query;
  let candidates = filterWines(wines, query);
  if (candidates.length === 0) {
    const vintageMatch = /^(.*\S)\s+((?:19|20)\d{2})$/.exec(query);
    if (!vintageMatch) return { status: 'none', query };
    effectiveQuery = vintageMatch[1];
    const vintage = Number(vintageMatch[2]);
    candidates = filterWines(wines, effectiveQuery);
    const vintageCandidates = candidates.filter((wine) => wine.vintage === vintage);
    if (vintageCandidates.length > 0) candidates = vintageCandidates;
    if (candidates.length === 0) return { status: 'none', query };
  }

  const ranked = [...candidates].sort((left, right) => {
    const stock = Number(right.quantity > 0) - Number(left.quantity > 0);
    if (stock !== 0) return stock;
    return left.name.localeCompare(right.name);
  });
  const queryKey = normalizeMatchText(effectiveQuery);
  const exactMatches = ranked.filter((wine) => normalizeMatchText(wine.name) === queryKey);

  if (exactMatches.length === 1) return { status: 'resolved', matchKind: 'exact', wine: exactMatches[0] };
  if (exactMatches.length > 1) return { status: 'ambiguous', query, candidates: exactMatches.slice(0, RESOLVE_CANDIDATE_LIMIT) };
  if (ranked.length === 1) return { status: 'resolved', matchKind: 'single_candidate', wine: ranked[0] };
  return { status: 'ambiguous', query, candidates: ranked.slice(0, RESOLVE_CANDIDATE_LIMIT) };
}
