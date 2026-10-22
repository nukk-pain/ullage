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
  readonly idempotencyPayload?: unknown;
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
  readonly idempotencyPayload?: unknown;
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
  | {
      readonly status: 'ambiguous';
      readonly query: string;
      readonly candidates: readonly Wine[];
      readonly total: number;
      readonly truncated: boolean;
    }
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

export function optionalInt(value: unknown, field = 'value'): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${field} must be a safe integer`);
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${field} must be a safe integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`);
  return parsed;
}

export function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionalDate(value: unknown, field = 'date'): string | null {
  if (value === undefined || value === null || value === '') return null;
  const s = optionalString(value);
  const dateTime = parseDateTimeInput(s);
  const datePart = dateTime?.date;
  if (dateTime === null || datePart === undefined) throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== datePart) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return datePart;
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
    vintage: optionalInt(input.vintage, 'vintage'),
    region: optionalString(input.region),
    country: optionalString(input.country),
    varietal: optionalString(input.varietal),
    price: optionalNumber(input.price),
    quantity: normalizeQuantity(input.quantity, 1),
    rating: null,
    notes: optionalString(input.notes),
    store: optionalString(input.store),
    purchaseDate: optionalDate(input.purchaseDate, 'purchaseDate'),
    drinkByDate: optionalDate(input.drinkByDate, 'drinkByDate'),
    location: optionalString(input.location)
  };
}

export function normalizeIdempotencyKey(value: unknown): string {
  return requireText(value, 'idempotencyKey');
}

export function normalizeBatchImport(input: BatchImportInput): NormalizedBatchImport {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('items must include at least one wine row');
  const purchaseDate = optionalDate(input.purchaseDate, 'purchaseDate');
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${optionalDate(s, field)}T00:00:00.000Z`;
  const dateTime = parseDateTimeInput(s);
  if (dateTime === null || dateTime.time === null) throw new Error(`${field} must be YYYY-MM-DD or an ISO8601 timestamp`);
  optionalDate(dateTime.date, field);
  const parsed = new Date(`${dateTime.date}T${dateTime.time}`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be YYYY-MM-DD or an ISO8601 timestamp`);
  return parsed.toISOString();
}

function parseDateTimeInput(value: string | null): { readonly date: string; readonly time: string | null } | null {
  if (value === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, date, hour, minute, second = '00', fraction = '', zone = ''] = match;
  if (hour === undefined) return { date, time: null };
  const h = Number(hour);
  const m = Number(minute);
  const sec = Number(second);
  if (h > 23 || m > 59 || sec > 59) return null;
  if (zone !== '' && zone !== 'Z') {
    const offset = /([+-])(\d{2}):(\d{2})/.exec(zone);
    if (!offset) return null;
    const hours = Number(offset[2]);
    const minutes = Number(offset[3]);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  }
  const milliseconds = fraction ? `.${fraction.padEnd(3, '0')}` : '';
  return { date, time: `${hour}:${minute}:${second}${milliseconds}${zone}` };
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
  const tastedAt = optionalDate(input.tastedAt, 'tastedAt');
  if (!tastedAt) throw new Error('tastedAt is required (YYYY-MM-DD)');
  return {
    wineName: requireName(input.name),
    vintage: optionalInt(input.vintage, 'vintage'),
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
    limit: Math.max(1, optionalInt(input.limit, 'limit') ?? 50),
    offset: Math.max(0, optionalInt(input.offset, 'offset') ?? 0)
  };
}

function normalizeMatchText(value: unknown): string {
  return typeof value === 'string'
    ? value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
}

function normalizeQueryText(value: unknown): string {
  const tokens = normalizeMatchText(value).split(' ').filter(Boolean);
  while (tokens.length > 1 && (tokens[0] === 'the' || tokens[0] === 'a' || tokens[0] === 'an')) tokens.shift();
  return tokens.join(' ');
}

export function filterTastings(tastings: readonly Tasting[], query: NormalizedTastingQuery): Tasting[] {
  const queryText = normalizeQueryText(query.query);
  const tokens = queryText.split(' ').filter(Boolean);
  const venueNeedle = normalizeMatchText(query.venue);
  return tastings
    .filter((tasting) => {
      if (query.source !== null && tasting.source !== query.source) return false;
      if (query.minRating !== null && (tasting.rating === null || tasting.rating < query.minRating)) return false;
      if (venueNeedle && !normalizeMatchText(tasting.venue).includes(venueNeedle)) return false;
      if (tokens.length > 0) {
        const haystack = [tasting.wineName, tasting.producer, tasting.region, tasting.venue, tasting.notes]
          .map(normalizeMatchText)
          .join(' ');
        if (!tokens.every((token) => haystack.includes(token))) return false;
      }
      return true;
    })
    .slice(query.offset, query.offset + query.limit);
}

// Case-insensitive search across the fields people actually remember. Every
// whitespace-separated query token must appear somewhere, in any field order.
export function filterWines(wines: readonly Wine[], query: unknown): Wine[] {
  const rawQuery = typeof query === 'string' ? query.trim() : '';
  if (!rawQuery) return [...wines];
  const needle = normalizeQueryText(rawQuery);
  if (!needle) return [];
  const tokens = needle.split(' ');
  return wines.filter((wine) => {
    const haystack = [wine.name, wine.vintage === null ? null : String(wine.vintage), wine.producer, wine.region, wine.varietal, wine.country]
      .map(normalizeMatchText)
      .join(' ');
    return tokens.every((token) => haystack.includes(token));
  });
}

const RESOLVE_CANDIDATE_LIMIT = 8;

export function resolveWineByName(wines: readonly Wine[], rawQuery: unknown): ResolveWineResult {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) return { status: 'none', query };

  const queryKey = normalizeQueryText(query);
  if (!queryKey) return { status: 'none', query };
  const wholeNameMatches = wines.filter((wine) => normalizeQueryText(wine.name) === queryKey);
  const search = searchWineCandidates(wines, query);
  const candidates = [...new Map([...wholeNameMatches, ...search.candidates].map((wine) => [wine.id, wine])).values()];
  return resolveWineCandidates(query, candidates, search.effectiveQuery);
}

function searchWineCandidates(wines: readonly Wine[], query: string): { candidates: Wine[]; effectiveQuery: string } {
  const vintageMatch = /(?<![\p{L}\p{N}])((?:19|20)\d{2})(?![\p{L}\p{N}])/u.exec(query);
  const withoutVintage = vintageMatch === null
    ? query
    : `${query.slice(0, vintageMatch.index)}${query.slice(vintageMatch.index + vintageMatch[0].length)}`;
  const effectiveQuery = vintageMatch !== null && normalizeQueryText(withoutVintage) ? withoutVintage : query;
  let candidates = filterWines(wines, effectiveQuery);
  if (effectiveQuery !== query && vintageMatch !== null) candidates = candidates.filter((wine) => wine.vintage === Number(vintageMatch[1]));
  return { candidates, effectiveQuery };
}

function rankWineCandidates(candidates: readonly Wine[]): Wine[] {
  return [...candidates].sort((left, right) => {
    const availabilityRank = (wine: Wine): number => wine.quantity === 0 ? 2 : wine.hold == null ? 0 : 1;
    const availability = availabilityRank(left) - availabilityRank(right);
    if (availability !== 0) return availability;
    return left.name.localeCompare(right.name);
  });
}

function resolveWineCandidates(query: string, candidates: readonly Wine[], effectiveQuery: string): ResolveWineResult {
  const ranked = rankWineCandidates(candidates);
  if (ranked.length === 0) return { status: 'none', query };
  if (ranked.length === 1) {
    const exactKeys = new Set([normalizeQueryText(query), normalizeQueryText(effectiveQuery)]);
    const matchKind = exactKeys.has(normalizeQueryText(ranked[0]?.name)) ? 'exact' : 'single_candidate';
    return { status: 'resolved', matchKind, wine: ranked[0] };
  }
  const candidatesPage = ranked.slice(0, RESOLVE_CANDIDATE_LIMIT);
  return { status: 'ambiguous', query, candidates: candidatesPage, total: ranked.length, truncated: ranked.length > candidatesPage.length };
}
