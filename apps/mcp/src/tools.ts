import type { CellarStore } from './cellar-store.js';
import type { McpTool } from './mcp.js';
import {
  addWineInput,
  batchImportInput,
  consumeInput,
  holdInput,
  idempotencyProp,
  importSchema,
  numberArg,
  optionalId,
  recommendationInput,
  recordTastingInput,
  releaseHoldInput,
  requiredWriteOptions,
  stringArg,
  tastingProps,
  tastingQueryInput,
  updateConsumptionInput,
  updateWineInput,
  wineProps
} from './tool-inputs.js';

export function createUllageTools(store: CellarStore): McpTool[] {
  return [
    {
      name: 'cellar_summary',
      description: 'Bounded summary of the cellar: wine count, total bottles, recent wines. Call this first to work from current state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => store.summary()
    },
    {
      name: 'list_wines',
      description: 'List every wine in the cellar with all fields (id, name, producer, vintage, region, varietal, quantity, rating, drink-by, etc.). Pass `query` to search by name, producer, region, varietal, or country.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Case-insensitive substring search' } }, additionalProperties: false },
      handler: async (args) => store.listWines(optionalId(args.query))
    },
    {
      name: 'get_wine',
      description: 'Get one wine by id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      handler: async (args) => {
        const id = stringArg(args, 'id');
        const wine = await store.getWine(id);
        if (!wine) throw new Error(`No wine with id ${id}`);
        return wine;
      }
    },
    {
      name: 'resolve_wine',
      description: 'Resolve what the user called a wine ("the Barolo", "Chablis 2020") to one cellar wine. Returns status resolved (use the wine id), ambiguous (ask the user to pick a candidate), or none. Call this before consume_wine or hold_wine when you only have a name.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The wine as the user said it' } }, required: ['query'], additionalProperties: false },
      handler: async (args) => store.resolveWine(stringArg(args, 'query'))
    },
    {
      name: 'add_wine',
      description: 'Add a bottle. Put the year in `vintage` (integer), not in `name`. quantity defaults to 1. Capture region/varietal/drink-by when known; from a receipt also capture price, purchaseDate (YYYY-MM-DD), and store.',
      inputSchema: { type: 'object', properties: { ...wineProps, ...idempotencyProp }, required: ['name', 'idempotencyKey'], additionalProperties: false },
      handler: async (args) => store.addWine(addWineInput(args), requiredWriteOptions(args))
    },
    {
      name: 'update_wine',
      description: 'Update fields of an existing wine by id. Only the fields you pass are changed.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...wineProps, ...idempotencyProp }, required: ['id', 'idempotencyKey'], additionalProperties: false },
      handler: async (args) => {
        const id = stringArg(args, 'id');
        const wine = await store.updateWine(id, updateWineInput(args), requiredWriteOptions(args));
        if (!wine) throw new Error(`No wine with id ${id}`);
        return wine;
      }
    },
    {
      name: 'consume_wine',
      description: 'Open/consume bottles of a wine by id: decrement quantity, record a rating and notes, and log a consumption event.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Wine id from list_wines' },
          quantity: { type: 'integer', minimum: 1, description: 'Bottles opened (default 1)' },
          rating: { type: 'number' },
          notes: { type: 'string' },
          ...idempotencyProp
        },
        required: ['id', 'idempotencyKey'],
        additionalProperties: false
      },
      handler: async (args) => {
        const id = stringArg(args, 'id');
        const wine = await store.consumeWine(id, consumeInput(args), requiredWriteOptions(args));
        if (!wine) throw new Error(`No wine with id ${id}`);
        return wine;
      }
    },
    {
      name: 'list_consumptions',
      description: 'List consumption history (when bottles were opened, with ratings/notes). Optionally filter by wine id.',
      inputSchema: { type: 'object', properties: { wineId: { type: 'string' } }, additionalProperties: false },
      handler: async (args) => store.listConsumptions(optionalId(args.wineId))
    },
    {
      name: 'update_consumption',
      description: 'Fix the rating or notes on a past consumption event (id from list_consumptions). Only the fields you pass change; set clearRating/clearNotes to true to erase a stored value.',
      inputSchema: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Consumption event id from list_consumptions' },
          rating: { type: 'number' },
          notes: { type: 'string' },
          clearRating: { type: 'boolean' },
          clearNotes: { type: 'boolean' },
          ...idempotencyProp
        },
        required: ['eventId', 'idempotencyKey'],
        additionalProperties: false
      },
      handler: async (args) => store.updateConsumption(stringArg(args, 'eventId'), updateConsumptionInput(args), requiredWriteOptions(args))
    },
    {
      name: 'record_tasting',
      description: 'Record a wine tasted OUTSIDE the cellar (restaurant, bar, a friend\'s bottle) — never touches inventory. For a bottle opened from the cellar use consume_wine instead. Capture venue, rating, food pairing, and price when known.',
      inputSchema: {
        type: 'object',
        properties: { ...tastingProps, ...idempotencyProp },
        required: ['name', 'tastedAt', 'idempotencyKey'],
        additionalProperties: false
      },
      handler: async (args) => store.recordTasting(recordTastingInput(args), requiredWriteOptions(args))
    },
    {
      name: 'list_tastings',
      description: 'Unified timeline of every wine actually drunk: cellar pours (source "cellar") plus outside tastings (source "external"), newest first. Filter by source, text query, minRating, or venue.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['cellar', 'external'] },
          query: { type: 'string', description: 'Case-insensitive search over wine, producer, region, venue, notes' },
          minRating: { type: 'number' },
          venue: { type: 'string' },
          limit: { type: 'integer', minimum: 1 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      handler: async (args) => store.listTastings(tastingQueryInput(args))
    },
    {
      name: 'add_note',
      description: 'Record a tasting note about a wine at any time (without opening it). Optionally include a rating.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Wine id from list_wines' },
          note: { type: 'string' },
          rating: { type: 'number' },
          ...idempotencyProp
        },
        required: ['id', 'note', 'idempotencyKey'],
        additionalProperties: false
      },
      handler: async (args) => store.addNote(stringArg(args, 'id'), args.note, args.rating, requiredWriteOptions(args))
    },
    {
      name: 'list_notes',
      description: 'List tasting notes over time. Optionally filter by wine id.',
      inputSchema: { type: 'object', properties: { wineId: { type: 'string' } }, additionalProperties: false },
      handler: async (args) => store.listNotes(optionalId(args.wineId))
    },
    {
      name: 'list_activity',
      description: 'Cellar activity log: every change (add, update, consume, note) as a one-line summary, newest first.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      handler: async (args) => store.listActivity(numberArg(args, 'limit') ?? 50)
    },
    {
      name: 'export_cellar',
      description: 'Export everything as JSON — wines, consumption history, tasting notes, and the activity log (backup / data ownership).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => store.exportJson()
    },
    {
      name: 'import_label_photo_wines',
      description: 'Save multiple agent-confirmed wines extracted from label photos as one atomic batch. The agent supplies structured fields after image/OCR work.',
      inputSchema: importSchema('label_photo'),
      handler: async (args) => store.importWines(batchImportInput(args, 'label_photo'))
    },
    {
      name: 'import_receipt_wines',
      description: 'Save multiple agent-confirmed wines extracted from a receipt photo as one atomic batch, including price, purchaseDate, and store when known.',
      inputSchema: importSchema('receipt'),
      handler: async (args) => store.importWines(batchImportInput(args, 'receipt'))
    },
    {
      name: 'hold_wine',
      description: 'Mark a wine as held so ordinary recommendations and consume_wine will not open it accidentally.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' }, ...idempotencyProp }, required: ['id', 'idempotencyKey'], additionalProperties: false },
      handler: async (args) => store.holdWine(stringArg(args, 'id'), holdInput(args))
    },
    {
      name: 'release_hold',
      description: 'Release the active hold on a wine so it can be recommended or consumed again.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...idempotencyProp }, required: ['id', 'idempotencyKey'], additionalProperties: false },
      handler: async (args) => store.releaseHold(stringArg(args, 'id'), releaseHoldInput(args))
    },
    {
      name: 'list_holds',
      description: 'List currently held wines.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => store.listHolds()
    },
    {
      name: 'recommend_wines',
      description: 'Return hold-aware bottle recommendations from the current cellar.',
      inputSchema: {
        type: 'object',
        properties: { occasion: { type: 'string' }, limit: { type: 'integer', minimum: 1 }, includeHeld: { type: 'boolean' } },
        additionalProperties: false
      },
      handler: async (args) => store.recommendWines(recommendationInput(args))
    }
  ];
}
