import type {
  ActivityEvent,
  AddWineInput,
  BatchImportInput,
  BatchImportResult,
  ConsumeInput,
  ConsumptionEvent,
  HoldInput,
  RecommendationInput,
  RecommendationResult,
  ReleaseHoldInput,
  RecordTastingInput,
  ResolveWineResult,
  Tasting,
  TastingNote,
  TastingQuery,
  UpdateConsumptionInput,
  Wine,
  WineHold,
  WriteOptions
} from '@ullage/domain';

export type Awaitable<T> = T | Promise<T>;

export type CellarSummary = {
  readonly wine_count: number; // wines with bottles remaining
  readonly bottle_count: number;
  readonly consumed_out_count: number; // wines drunk to zero, kept for history
  readonly recent_wines: readonly { readonly id: string; readonly name: string; readonly quantity: number; readonly hold: WineHold | null }[];
};

export type CellarExport = {
  readonly wines: readonly Wine[];
  readonly consumptions: readonly ConsumptionEvent[];
  readonly notes: readonly TastingNote[];
  readonly activity: readonly ActivityEvent[];
  readonly holds: readonly WineHold[];
  readonly imports: readonly BatchImportResult[];
  readonly tastings: readonly Tasting[];
};

export interface CellarStore {
  replayIdempotent?(operation: string, key: string, payload: unknown): Awaitable<unknown | undefined>;
  addWine(input: AddWineInput, options?: WriteOptions): Awaitable<Wine>;
  importWines(input: BatchImportInput): Awaitable<BatchImportResult>;
  listWines(query?: string, inStock?: boolean): Awaitable<Wine[]>;
  getWine(id: string): Awaitable<Wine | undefined>;
  resolveWine(query: string): Awaitable<ResolveWineResult>;
  updateWine(id: string, input: Partial<AddWineInput>, options?: WriteOptions): Awaitable<Wine | undefined>;
  consumeWine(id: string, input: ConsumeInput, options?: WriteOptions): Awaitable<Wine | undefined>;
  listConsumptions(wineId?: string): Awaitable<ConsumptionEvent[]>;
  updateConsumption(eventId: string, input: UpdateConsumptionInput, options?: WriteOptions): Awaitable<ConsumptionEvent>;
  recordTasting(input: RecordTastingInput, options?: WriteOptions): Awaitable<Tasting>;
  listTastings(query?: TastingQuery): Awaitable<Tasting[]>;
  addNote(wineId: string, note: unknown, rating?: unknown, options?: WriteOptions): Awaitable<TastingNote>;
  listNotes(wineId?: string): Awaitable<TastingNote[]>;
  holdWine(id: string, input: HoldInput): Awaitable<WineHold>;
  releaseHold(id: string, input: ReleaseHoldInput): Awaitable<WineHold>;
  listHolds(): Awaitable<WineHold[]>;
  recommendWines(input: RecommendationInput): Awaitable<RecommendationResult>;
  listActivity(limit?: number): Awaitable<ActivityEvent[]>;
  summary(): Awaitable<CellarSummary>;
  exportJson(): Awaitable<CellarExport>;
  close(): Awaitable<void>;
}
