#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SqliteCellarStore } from './store.js';
import { runMcpServer } from './mcp.js';

// Zero-config local cellar: a SQLite file under ~/.ullage (override with ULLAGE_DB).
const dbPath = process.env.ULLAGE_DB ?? join(homedir(), '.ullage', 'cellar.db');
const store = new SqliteCellarStore(dbPath);

const wineProps = {
  name: { type: 'string', description: 'Wine name without the year, e.g. "Barolo"' },
  producer: { type: 'string' },
  vintage: { type: 'integer', description: 'Vintage year, e.g. 2016' },
  region: { type: 'string' },
  country: { type: 'string' },
  varietal: { type: 'string', description: 'Grape(s), e.g. "Nebbiolo"' },
  price: { type: 'number' },
  quantity: { type: 'integer', minimum: 0 },
  notes: { type: 'string' },
  store: { type: 'string', description: 'Where it was bought' },
  purchaseDate: { type: 'string', description: 'YYYY-MM-DD' },
  drinkByDate: { type: 'string', description: 'YYYY-MM-DD — drink-by window' },
  location: { type: 'string', description: 'Where it is stored' }
};

runMcpServer({
  name: 'ullage',
  version: '0.1.0',
  tools: [
    {
      name: 'cellar_summary',
      description: 'Bounded summary of the cellar: wine count, total bottles, recent wines. Call this first to work from current state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => store.summary()
    },
    {
      name: 'list_wines',
      description: 'List every wine in the cellar with all fields (id, name, producer, vintage, region, varietal, quantity, rating, drink-by, etc.).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => store.listWines()
    },
    {
      name: 'get_wine',
      description: 'Get one wine by id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      handler: (args) => {
        const id = String((args as { id?: unknown }).id ?? '');
        const wine = store.getWine(id);
        if (!wine) throw new Error(`No wine with id ${id}`);
        return wine;
      }
    },
    {
      name: 'add_wine',
      description: 'Add a bottle. Put the year in `vintage` (integer), not in `name`. quantity defaults to 1. Capture region/varietal/drink-by when known; from a receipt also capture price, purchaseDate (YYYY-MM-DD), and store.',
      inputSchema: { type: 'object', properties: wineProps, required: ['name'], additionalProperties: false },
      handler: (args) => store.addWine(args as never)
    },
    {
      name: 'update_wine',
      description: 'Update fields of an existing wine by id. Only the fields you pass are changed.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...wineProps }, required: ['id'], additionalProperties: false },
      handler: (args) => {
        const { id, ...rest } = args as { id?: unknown };
        const idStr = String(id ?? '');
        const wine = store.updateWine(idStr, rest as never);
        if (!wine) throw new Error(`No wine with id ${idStr}`);
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
          notes: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      },
      handler: (args) => {
        const id = String((args as { id?: unknown }).id ?? '');
        const wine = store.consumeWine(id, args as never);
        if (!wine) throw new Error(`No wine with id ${id}`);
        return wine;
      }
    },
    {
      name: 'list_consumptions',
      description: 'List consumption history (when bottles were opened, with ratings/notes). Optionally filter by wine id.',
      inputSchema: { type: 'object', properties: { wineId: { type: 'string' } }, additionalProperties: false },
      handler: (args) => store.listConsumptions(optionalId((args as { wineId?: unknown }).wineId))
    },
    {
      name: 'add_note',
      description: 'Record a tasting note about a wine at any time (without opening it). Optionally include a rating.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Wine id from list_wines' },
          note: { type: 'string' },
          rating: { type: 'number' }
        },
        required: ['id', 'note'],
        additionalProperties: false
      },
      handler: (args) => {
        const a = args as { id?: unknown; note?: unknown; rating?: unknown };
        return store.addNote(String(a.id ?? ''), a.note, a.rating);
      }
    },
    {
      name: 'list_notes',
      description: 'List tasting notes over time. Optionally filter by wine id.',
      inputSchema: { type: 'object', properties: { wineId: { type: 'string' } }, additionalProperties: false },
      handler: (args) => store.listNotes(optionalId((args as { wineId?: unknown }).wineId))
    },
    {
      name: 'list_activity',
      description: 'Cellar activity log: every change (add, update, consume, note) as a one-line summary, newest first.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      handler: (args) => {
        const limit = (args as { limit?: unknown }).limit;
        return store.listActivity(typeof limit === 'number' ? limit : 50);
      }
    },
    {
      name: 'export_cellar',
      description: 'Export everything as JSON — wines, consumption history, tasting notes, and the activity log (backup / data ownership).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => store.exportJson()
    }
  ]
});

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
