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
  TastingNote,
  Wine,
  WineHold,
  WriteOptions
} from '@ullage/domain';

export type Awaitable<T> = T | Promise<T>;

export type CellarSummary = {
  readonly wine_count: number;
  readonly bottle_count: number;
  readonly recent_wines: readonly { readonly id: string; readonly name: string; readonly quantity: number }[];
};

export type CellarExport = {
  readonly wines: readonly Wine[];
  readonly consumptions: readonly ConsumptionEvent[];
  readonly notes: readonly TastingNote[];
  readonly activity: readonly ActivityEvent[];
  readonly holds: readonly WineHold[];
  readonly imports: readonly BatchImportResult[];
};

export interface CellarStore {
  addWine(input: AddWineInput, options?: WriteOptions): Awaitable<Wine>;
  importWines(input: BatchImportInput): Awaitable<BatchImportResult>;
  listWines(): Awaitable<Wine[]>;
  getWine(id: string): Awaitable<Wine | undefined>;
  updateWine(id: string, input: Partial<AddWineInput>, options?: WriteOptions): Awaitable<Wine | undefined>;
  consumeWine(id: string, input: ConsumeInput, options?: WriteOptions): Awaitable<Wine | undefined>;
  listConsumptions(wineId?: string): Awaitable<ConsumptionEvent[]>;
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
