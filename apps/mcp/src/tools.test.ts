import test from 'node:test';
import assert from 'node:assert/strict';
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
import type { CellarStore, CellarExport, CellarSummary } from './cellar-store.js';
import type { McpTool } from './mcp.js';
import { createUllageTools } from './tools.js';

const sampleWine: Wine = {
  id: 'wine-1',
  name: 'Chablis',
  producer: 'Raveneau',
  vintage: 2020,
  region: 'Burgundy',
  country: 'France',
  varietal: 'Chardonnay',
  price: 90,
  quantity: 2,
  rating: null,
  notes: null,
  store: null,
  purchaseDate: null,
  drinkByDate: null,
  location: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const sampleHold: WineHold = {
  id: 'hold-1',
  wineId: 'wine-1',
  reason: 'Anniversary',
  until: '2030-01-01',
  createdAt: '2026-01-02T00:00:00.000Z',
  releasedAt: null
};

const sampleTasting: Tasting = {
  id: 'tasting-1',
  source: 'external',
  wineId: null,
  wineName: 'Barolo',
  vintage: 2016,
  producer: null,
  region: null,
  venue: 'Osteria Roma',
  foodPairing: ['bistecca'],
  rating: 4.5,
  price: 18,
  currency: 'EUR',
  notes: 'by the glass',
  imageUrl: null,
  tastedAt: '2026-07-30',
  createdAt: '2026-07-30T12:00:00.000Z'
};

class AsyncFakeStore implements CellarStore {
  readonly addedInputs: AddWineInput[] = [];
  readonly addedOptions: WriteOptions[] = [];
  readonly importInputs: BatchImportInput[] = [];
  readonly updatedInputs: Array<{ readonly id: string; readonly input: Partial<AddWineInput>; readonly options: WriteOptions }> = [];
  readonly consumedInputs: Array<{ readonly id: string; readonly input: ConsumeInput; readonly options: WriteOptions }> = [];
  readonly notes: Array<{ readonly id: string; readonly note: unknown; readonly rating: unknown; readonly options: WriteOptions }> = [];
  readonly holdInputs: Array<{ readonly id: string; readonly input: HoldInput }> = [];
  readonly releaseInputs: Array<{ readonly id: string; readonly input: ReleaseHoldInput }> = [];
  readonly recommendationInputs: RecommendationInput[] = [];
  readonly consumptionFilters: Array<string | undefined> = [];
  readonly noteFilters: Array<string | undefined> = [];
  readonly activityLimits: number[] = [];
  readonly resolveQueries: string[] = [];
  readonly consumptionUpdates: Array<{ readonly eventId: string; readonly input: UpdateConsumptionInput; readonly options: WriteOptions }> = [];
  readonly tastingInputs: Array<{ readonly input: RecordTastingInput; readonly options: WriteOptions }> = [];
  readonly tastingQueries: TastingQuery[] = [];

  async addWine(input: AddWineInput, options: WriteOptions = {}): Promise<Wine> {
    this.addedInputs.push(input);
    this.addedOptions.push(options);
    return sampleWine;
  }

  async importWines(input: BatchImportInput): Promise<BatchImportResult> {
    this.importInputs.push(input);
    return { id: 'import-1', source: 'receipt', sourceId: 'receipt-1', purchaseDate: null, receiptImageUrl: null, wines: [sampleWine], createdAt: sampleWine.createdAt };
  }

  async listWines(): Promise<Wine[]> {
    return [sampleWine];
  }

  async getWine(id: string): Promise<Wine | undefined> {
    return id === sampleWine.id ? sampleWine : undefined;
  }

  async updateWine(id: string, input: Partial<AddWineInput>, options: WriteOptions = {}): Promise<Wine | undefined> {
    this.updatedInputs.push({ id, input, options });
    return id === sampleWine.id ? { ...sampleWine, region: typeof input.region === 'string' ? input.region : sampleWine.region } : undefined;
  }

  async consumeWine(id: string, input: ConsumeInput, options: WriteOptions = {}): Promise<Wine | undefined> {
    this.consumedInputs.push({ id, input, options });
    return id === sampleWine.id ? { ...sampleWine, quantity: 1 } : undefined;
  }

  async listConsumptions(wineId?: string): Promise<ConsumptionEvent[]> {
    this.consumptionFilters.push(wineId);
    return [{ id: 'consume-1', wineId: sampleWine.id, quantity: 1, rating: 4, notes: 'salty', consumedAt: sampleWine.updatedAt }];
  }

  async addNote(wineId: string, note: unknown, rating?: unknown, options: WriteOptions = {}): Promise<TastingNote> {
    this.notes.push({ id: wineId, note, rating, options });
    return { id: 'note-1', wineId, note: String(note), rating: typeof rating === 'number' ? rating : null, createdAt: sampleWine.updatedAt };
  }

  async holdWine(id: string, input: HoldInput): Promise<WineHold> {
    this.holdInputs.push({ id, input });
    return sampleHold;
  }

  async releaseHold(id: string, input: ReleaseHoldInput): Promise<WineHold> {
    this.releaseInputs.push({ id, input });
    return { ...sampleHold, releasedAt: '2026-01-03T00:00:00.000Z' };
  }

  async listHolds(): Promise<WineHold[]> {
    return [sampleHold];
  }

  async recommendWines(input: RecommendationInput): Promise<RecommendationResult> {
    this.recommendationInputs.push(input);
    return { recommendations: [{ wine: sampleWine, reason: 'available' }], excludedHeldCount: 0 };
  }

  async listNotes(wineId?: string): Promise<TastingNote[]> {
    this.noteFilters.push(wineId);
    return [{ id: 'note-1', wineId: sampleWine.id, note: 'lime', rating: null, createdAt: sampleWine.updatedAt }];
  }

  async listActivity(limit?: number): Promise<ActivityEvent[]> {
    this.activityLimits.push(limit ?? 50);
    return [{ id: 'activity-1', action: 'add', wineId: sampleWine.id, summary: 'Added Chablis', createdAt: sampleWine.createdAt }];
  }

  async summary(): Promise<CellarSummary> {
    return { wine_count: 1, bottle_count: 2, consumed_out_count: 0, recent_wines: [{ id: sampleWine.id, name: sampleWine.name, quantity: sampleWine.quantity, hold: null }] };
  }

  async exportJson(): Promise<CellarExport> {
    return { wines: [sampleWine], consumptions: [], notes: [], activity: [], holds: [sampleHold], imports: [], tastings: [] };
  }

  async resolveWine(query: string): Promise<ResolveWineResult> {
    this.resolveQueries.push(query);
    return { status: 'resolved', matchKind: 'exact', wine: sampleWine };
  }

  async updateConsumption(eventId: string, input: UpdateConsumptionInput, options: WriteOptions = {}): Promise<ConsumptionEvent> {
    this.consumptionUpdates.push({ eventId, input, options });
    return { id: eventId, wineId: sampleWine.id, quantity: 1, rating: 4, notes: 'fixed', consumedAt: sampleWine.updatedAt };
  }

  async recordTasting(input: RecordTastingInput, options: WriteOptions = {}): Promise<Tasting> {
    this.tastingInputs.push({ input, options });
    return sampleTasting;
  }

  async listTastings(query: TastingQuery = {}): Promise<Tasting[]> {
    this.tastingQueries.push(query);
    return [sampleTasting];
  }

  async close(): Promise<void> {}
}

test('createUllageTools exposes the existing MCP tool names in order', () => {
  const tools = createUllageTools(new AsyncFakeStore());
  assert.deepEqual(tools.map((tool) => tool.name), [
    'cellar_summary',
    'list_wines',
    'get_wine',
    'resolve_wine',
    'add_wine',
    'update_wine',
    'consume_wine',
    'list_consumptions',
    'update_consumption',
    'record_tasting',
    'list_tastings',
    'add_note',
    'list_notes',
    'list_activity',
    'export_cellar',
    'import_label_photo_wines',
    'import_receipt_wines',
    'hold_wine',
    'release_hold',
    'list_holds',
    'recommend_wines'
  ]);
});

test('resolve_wine, update_consumption, record_tasting, and list_tastings delegate to the store', async () => {
  const store = new AsyncFakeStore();
  const tools = createUllageTools(store);

  const resolved = await tool(tools, 'resolve_wine').handler({ query: 'the Barolo' });
  assert.deepEqual(store.resolveQueries, ['the Barolo']);
  assert.deepEqual(resolved, { status: 'resolved', matchKind: 'exact', wine: sampleWine });

  const updated = await tool(tools, 'update_consumption').handler({ eventId: 'consume-1', rating: 4, clearNotes: true, idempotencyKey: 'fix-1' });
  assert.equal(store.consumptionUpdates.length, 1);
  assert.deepEqual(store.consumptionUpdates[0], {
    eventId: 'consume-1',
    input: { rating: 4, clearNotes: true },
    options: { idempotencyKey: 'fix-1' }
  });
  assert.equal((updated as ConsumptionEvent).notes, 'fixed');

  await tool(tools, 'record_tasting').handler({
    name: 'Barolo', tastedAt: '2026-07-30', venue: 'Osteria Roma', rating: 4.5, foodPairing: ['bistecca'], idempotencyKey: 'tasting-1'
  });
  assert.equal(store.tastingInputs.length, 1);
  assert.deepEqual(store.tastingInputs[0].input, {
    name: 'Barolo', tastedAt: '2026-07-30', venue: 'Osteria Roma', rating: 4.5, foodPairing: ['bistecca']
  });
  assert.deepEqual(store.tastingInputs[0].options, { idempotencyKey: 'tasting-1' });

  const timeline = await tool(tools, 'list_tastings').handler({ source: 'external', minRating: 4 });
  assert.deepEqual(store.tastingQueries, [{ source: 'external', minRating: 4 }]);
  assert.deepEqual(timeline, [sampleTasting]);

  const searched = await tool(tools, 'list_wines').handler({ query: 'chablis' });
  assert.deepEqual(searched, [sampleWine]);

  await assert.rejects(async () => tool(tools, 'update_consumption').handler({ eventId: 'consume-1', rating: 4 }), /idempotencyKey is required/);
  await assert.rejects(async () => tool(tools, 'record_tasting').handler({ name: 'Barolo', tastedAt: '2026-07-30' }), /idempotencyKey is required/);
});

test('createUllageTools handlers await an injected store and preserve output shapes', async () => {
  const store = new AsyncFakeStore();
  const tools = createUllageTools(store);

  const summary = await tool(tools, 'cellar_summary').handler({});
  assert.deepEqual(summary, { wine_count: 1, bottle_count: 2, consumed_out_count: 0, recent_wines: [{ id: 'wine-1', name: 'Chablis', quantity: 2, hold: null }] });

  const added = await tool(tools, 'add_wine').handler({ name: 'Chablis', quantity: 2, idempotencyKey: 'add-key-1' });
  assert.deepEqual(added, sampleWine);
  assert.deepEqual(store.addedInputs, [{ name: 'Chablis', quantity: 2 }]);
  assert.deepEqual(store.addedOptions, [{ idempotencyKey: 'add-key-1' }]);

  const imported = await tool(tools, 'import_receipt_wines').handler({
    idempotencyKey: 'receipt-key-1',
    sourceId: 'receipt-1',
    items: [{ name: 'Chablis', quantity: 2, itemKey: 'line-1' }]
  });
  assert.deepEqual(imported, { id: 'import-1', source: 'receipt', sourceId: 'receipt-1', purchaseDate: null, receiptImageUrl: null, wines: [sampleWine], createdAt: sampleWine.createdAt });
  assert.deepEqual(store.importInputs, [
    {
      idempotencyKey: 'receipt-key-1', source: 'receipt', sourceId: 'receipt-1',
      purchaseDate: undefined, receiptImageUrl: undefined,
      items: [{ name: 'Chablis', quantity: 2, itemKey: 'line-1' }]
    }
  ]);

  const updated = await tool(tools, 'update_wine').handler({ id: 'wine-1', region: 'Burgundy', idempotencyKey: 'update-key-1' });
  assert.equal(isWine(updated) ? updated.region : null, 'Burgundy');
  assert.deepEqual(store.updatedInputs, [{ id: 'wine-1', input: { region: 'Burgundy' }, options: { idempotencyKey: 'update-key-1' } }]);

  const consumed = await tool(tools, 'consume_wine').handler({ id: 'wine-1', quantity: 1, rating: 4, idempotencyKey: 'consume-key-1' });
  assert.equal(isWine(consumed) ? consumed.quantity : null, 1);
  assert.deepEqual(store.consumedInputs, [{ id: 'wine-1', input: { quantity: 1, rating: 4 }, options: { idempotencyKey: 'consume-key-1' } }]);

  const consumptions = await tool(tools, 'list_consumptions').handler({ wineId: ' wine-1 ' });
  assert.equal(Array.isArray(consumptions), true);
  assert.deepEqual(store.consumptionFilters, ['wine-1']);

  const note = await tool(tools, 'add_note').handler({ id: 'wine-1', note: 'mineral', rating: 4.2, idempotencyKey: 'note-key-1' });
  assert.deepEqual(note, { id: 'note-1', wineId: 'wine-1', note: 'mineral', rating: 4.2, createdAt: sampleWine.updatedAt });
  assert.deepEqual(store.notes, [{ id: 'wine-1', note: 'mineral', rating: 4.2, options: { idempotencyKey: 'note-key-1' } }]);

  assert.deepEqual(await tool(tools, 'hold_wine').handler({ id: 'wine-1', reason: 'Anniversary', until: '2030-01-01', idempotencyKey: 'hold-key-1' }), sampleHold);
  assert.deepEqual(store.holdInputs, [{ id: 'wine-1', input: { reason: 'Anniversary', until: '2030-01-01', idempotencyKey: 'hold-key-1' } }]);

  assert.equal((await tool(tools, 'list_holds').handler({}) as WineHold[]).length, 1);
  assert.equal((await tool(tools, 'recommend_wines').handler({ occasion: 'dinner', limit: 2 }) as RecommendationResult).recommendations.length, 1);
  assert.deepEqual(store.recommendationInputs, [{ occasion: 'dinner', limit: 2 }]);

  await tool(tools, 'release_hold').handler({ id: 'wine-1', idempotencyKey: 'release-key-1' });
  assert.deepEqual(store.releaseInputs, [{ id: 'wine-1', input: { idempotencyKey: 'release-key-1' } }]);

  await tool(tools, 'list_notes').handler({ wineId: '' });
  assert.deepEqual(store.noteFilters, [undefined]);

  await tool(tools, 'list_activity').handler({ limit: 3 });
  assert.deepEqual(store.activityLimits, [3]);

  const exported = await tool(tools, 'export_cellar').handler({});
  assert.deepEqual(exported, { wines: [sampleWine], consumptions: [], notes: [], activity: [], holds: [sampleHold], imports: [], tastings: [] });
});

test('createUllageTools requires idempotencyKey for confirmed write tools', async () => {
  const tools = createUllageTools(new AsyncFakeStore());

  await assert.rejects(async () => tool(tools, 'add_wine').handler({ name: 'Chablis' }), /idempotencyKey is required/);
  await assert.rejects(async () => tool(tools, 'update_wine').handler({ id: 'wine-1', region: 'Burgundy' }), /idempotencyKey is required/);
  await assert.rejects(async () => tool(tools, 'consume_wine').handler({ id: 'wine-1', quantity: 1 }), /idempotencyKey is required/);
  await assert.rejects(async () => tool(tools, 'add_note').handler({ id: 'wine-1', note: 'mineral' }), /idempotencyKey is required/);
  await assert.rejects(async () => tool(tools, 'hold_wine').handler({ id: 'wine-1', reason: 'Anniversary' }), /idempotencyKey is required/);
  await assert.rejects(async () => tool(tools, 'release_hold').handler({ id: 'wine-1' }), /idempotencyKey is required/);
});

test('createUllageTools reports missing wines with current error text', async () => {
  const tools = createUllageTools(new AsyncFakeStore());
  await assert.rejects(async () => {
    await tool(tools, 'get_wine').handler({ id: 'missing' });
  }, /No wine with id missing/);
  await assert.rejects(async () => {
    await tool(tools, 'update_wine').handler({ id: 'missing', quantity: 1, idempotencyKey: 'missing-update-key' });
  }, /No wine with id missing/);
  await assert.rejects(async () => {
    await tool(tools, 'consume_wine').handler({ id: 'missing', quantity: 1, idempotencyKey: 'missing-consume-key' });
  }, /No wine with id missing/);
});

function tool(tools: readonly McpTool[], name: string): McpTool {
  const found = tools.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Missing tool ${name}`);
  return found;
}

function isWine(value: unknown): value is Wine {
  return typeof value === 'object' && value !== null && 'id' in value && 'quantity' in value;
}
