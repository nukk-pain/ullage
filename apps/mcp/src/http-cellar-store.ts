import {
  filterWines,
  normalizeAddWine,
  normalizeQuantity,
  optionalNumber,
  optionalString,
  optionalTimestamp,
  resolveWineByName,
  type AddWineInput,
  type BatchImportInput,
  type BatchImportResult,
  type ConsumeInput,
  type ConsumptionEvent,
  type HoldInput,
  type RecommendationInput,
  type RecommendationResult,
  type ReleaseHoldInput,
  type RecordTastingInput,
  type ResolveWineResult,
  type Tasting,
  type TastingQuery,
  type UpdateConsumptionInput,
  type Wine,
  type WineHold,
  type WriteOptions
} from '@ullage/domain';
import type { CellarExport, CellarStore, CellarSummary } from './cellar-store.js';
import { sendJsonRequest, type HttpHeaders, type JsonObject } from './http-cellar-client.js';
import { consumptionPageFromJson, describeWine, hashPayload, putIfPresent, wineFromConsumeResponse, wineFromJson, wineListFromJson } from './http-cellar-mappers.js';

const CONSUMPTION_PAGE_SIZE = 100;

type StoreRequestOptions = {
  readonly body?: JsonObject;
  readonly okStatuses?: readonly number[];
};

export class UnsupportedHttpOperationError extends Error {
  readonly name = 'UnsupportedHttpOperationError';

  constructor(operation: string) {
    super(`${operation} is unsupported-by-http-backend yet; the configured HTTP backend does not expose faithful ullage semantics for this method.`);
  }
}

export class HttpCellarStore implements CellarStore {
  private readonly baseUrl: string;
  private readonly headers: HttpHeaders;
  private readonly idempotency = new Map<string, { readonly operation: string; readonly payloadHash: string; readonly result: Promise<unknown> }>();

  constructor(baseUrl: string, headers: HttpHeaders = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.headers = headers;
  }

  async addWine(input: AddWineInput, options: WriteOptions = {}): Promise<Wine> {
    return this.idempotent('addWine', options.idempotencyKey, input, async () => {
      const fields = normalizeAddWine(input);
      if (fields.quantity <= 0) {
        throw new Error('HTTP wine API requires quantity greater than 0 when adding wine');
      }
      const payload: JsonObject = {
        name: fields.name,
        quantity: fields.quantity
      };
      putIfPresent(payload, 'producer', fields.producer);
      putIfPresent(payload, 'vintage', fields.vintage === null ? null : String(fields.vintage));
      putIfPresent(payload, 'region', fields.region);
      putIfPresent(payload, 'country', fields.country);
      putIfPresent(payload, 'varietal', fields.varietal);
      putIfPresent(payload, 'grape_variety', fields.varietal);
      putIfPresent(payload, 'price', fields.price);
      putIfPresent(payload, 'store', fields.store);
      putIfPresent(payload, 'purchase_date', fields.purchaseDate);
      putIfPresent(payload, 'notes', fields.notes);

      const response = await this.request('POST', '/wines', { body: payload });
      return wineFromJson(response.body);
    });
  }

  async listWines(query?: string, inStock?: boolean): Promise<Wine[]> {
    const response = await this.request('GET', '/wines');
    const filtered = filterWines(wineListFromJson(response.body), query);
    if (inStock === undefined) return filtered;
    return filtered.filter((wine) => (inStock ? wine.quantity > 0 : wine.quantity === 0));
  }

  async getWine(id: string): Promise<Wine | undefined> {
    const response = await this.request('GET', `/wines/${encodeURIComponent(id)}`, { okStatuses: [404] });
    return response.status === 404 ? undefined : wineFromJson(response.body);
  }

  async resolveWine(query: string): Promise<ResolveWineResult> {
    return resolveWineByName(await this.listWines(), query);
  }

  async importWines(_input: BatchImportInput): Promise<BatchImportResult> {
    throw new UnsupportedHttpOperationError('importWines');
  }

  async updateConsumption(_eventId: string, _input: UpdateConsumptionInput, _options: WriteOptions = {}): Promise<ConsumptionEvent> {
    throw new UnsupportedHttpOperationError('updateConsumption');
  }

  async recordTasting(_input: RecordTastingInput, _options: WriteOptions = {}): Promise<Tasting> {
    throw new UnsupportedHttpOperationError('recordTasting');
  }

  async listTastings(_query?: TastingQuery): Promise<Tasting[]> {
    throw new UnsupportedHttpOperationError('listTastings');
  }

  async updateWine(_id: string, _input: Partial<AddWineInput>, _options: WriteOptions = {}): Promise<Wine | undefined> {
    throw new UnsupportedHttpOperationError('updateWine');
  }

  async consumeWine(id: string, input: ConsumeInput, options: WriteOptions = {}): Promise<Wine | undefined> {
    return this.idempotent('consumeWine', options.idempotencyKey, { id, input }, async () => {
      const existing = await this.getWine(id);
      if (!existing) return undefined;
      const requested = normalizeQuantity(input.quantity, 1);
      if (requested <= 0) return existing;
      if (existing.quantity <= 0) throw new Error(`No bottles of ${describeWine(existing)} left to open`);
      const consumed = Math.min(requested, existing.quantity);

      const payload: JsonObject = {};
      const rating = optionalNumber(input.rating);
      if (rating !== null) payload.rating = Math.trunc(rating);
      const notes = optionalString(input.notes);
      putIfPresent(payload, 'note', notes);
      putIfPresent(payload, 'consumed_at', optionalTimestamp(input.consumedAt, 'consumedAt'));

      let latest: Wine = existing;
      for (let i = 0; i < consumed; i += 1) {
        const response = await this.request('POST', `/wines/${encodeURIComponent(id)}/consume`, { body: payload, okStatuses: [404] });
        if (response.status === 404) return undefined;
        latest = wineFromConsumeResponse(response.body);
      }
      return latest;
    });
  }

  async listConsumptions(wineId?: string): Promise<ConsumptionEvent[]> {
    const events: ConsumptionEvent[] = [];
    let offset = 0;
    let total: number | null = null;
    while (true) {
      const response = await this.request('GET', `/wines?status=Consumed&limit=${CONSUMPTION_PAGE_SIZE}&offset=${offset}`);
      const page = consumptionPageFromJson(response.body);
      if (page.events.length === 0) break;
      events.push(...page.events);
      total = page.total;
      offset += page.events.length;
      if (total === null || offset >= total) break;
    }
    return wineId ? events.filter((event) => event.wineId === wineId) : events;
  }

  async addNote(_wineId: string, _note: unknown, _rating?: unknown, _options: WriteOptions = {}): Promise<never> {
    throw new UnsupportedHttpOperationError('addNote');
  }

  async listNotes(_wineId?: string): Promise<never> {
    throw new UnsupportedHttpOperationError('listNotes');
  }

  async holdWine(_id: string, _input: HoldInput): Promise<WineHold> {
    throw new UnsupportedHttpOperationError('holdWine');
  }

  async releaseHold(_id: string, _input: ReleaseHoldInput): Promise<WineHold> {
    throw new UnsupportedHttpOperationError('releaseHold');
  }

  async listHolds(): Promise<WineHold[]> {
    throw new UnsupportedHttpOperationError('listHolds');
  }

  async recommendWines(_input: RecommendationInput): Promise<RecommendationResult> {
    throw new UnsupportedHttpOperationError('recommendWines');
  }

  async listActivity(_limit?: number): Promise<never> {
    throw new UnsupportedHttpOperationError('listActivity');
  }

  async summary(): Promise<CellarSummary> {
    const wines = await this.listWines();
    const inStock = wines.filter((wine) => wine.quantity > 0);
    return {
      wine_count: inStock.length,
      bottle_count: inStock.reduce((sum, wine) => sum + wine.quantity, 0),
      consumed_out_count: wines.length - inStock.length,
      recent_wines: inStock.slice(0, 5).map((wine) => ({ id: wine.id, name: wine.name, quantity: wine.quantity, hold: wine.hold ?? null }))
    };
  }

  async exportJson(): Promise<CellarExport> {
    throw new UnsupportedHttpOperationError('exportJson');
  }

  close(): void {}

  private async request(method: 'GET' | 'POST', path: string, options: StoreRequestOptions = {}): Promise<{ readonly status: number; readonly body: unknown }> {
    const url = new URL(`${this.baseUrl}${path}`);
    const response = await sendJsonRequest(url, method, { body: options.body, headers: this.headers });
    if ((response.status < 200 || response.status >= 300) && !options.okStatuses?.includes(response.status)) {
      throw new Error(`HTTP wine API ${method} ${path} failed with HTTP ${response.status}: upstream error response omitted`);
    }
    return response;
  }

  private async idempotent<T>(operation: string, key: string | undefined, payload: unknown, work: () => Promise<T>): Promise<T> {
    if (key === undefined || key.trim().length === 0) return work();
    const payloadHash = hashPayload(operation, payload);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.operation !== operation || existing.payloadHash !== payloadHash) throw new Error(`idempotencyKey ${key} was already used with a different payload`);
      return existing.result as Promise<T>;
    }
    const result = work();
    this.idempotency.set(key, { operation, payloadHash, result });
    try {
      return await result;
    } catch (error) {
      this.idempotency.delete(key);
      throw error;
    }
  }
}
