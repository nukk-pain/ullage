import type { AddWineInput, BatchImportInput, ConsumeInput, HoldInput, RecommendationInput, ReleaseHoldInput, WriteOptions } from '@ullage/domain';

export const wineProps = {
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
  drinkByDate: { type: 'string', description: 'YYYY-MM-DD - drink-by window' },
  location: { type: 'string', description: 'Where it is stored' }
} satisfies Record<string, Record<string, unknown>>;

export const idempotencyProp = { idempotencyKey: { type: 'string', description: 'Stable caller key for a confirmed write action' } };

const importItemProps = { ...wineProps, itemKey: { type: 'string' }, kind: { type: 'string' } };

export function importSchema(source: 'receipt' | 'label_photo'): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ...idempotencyProp,
      sourceId: { type: 'string' },
      items: { type: 'array', minItems: 1, items: { type: 'object', properties: importItemProps, required: ['name'], additionalProperties: false } }
    },
    required: ['idempotencyKey', 'items'],
    additionalProperties: false,
    description: source
  };
}

export function addWineInput(args: Record<string, unknown>): AddWineInput {
  return wineInputFromArgs(args, true);
}

export function updateWineInput(args: Record<string, unknown>): Partial<AddWineInput> {
  return wineInputFromArgs(args, false);
}

export function consumeInput(args: Record<string, unknown>): ConsumeInput {
  const input: ConsumeInput = {};
  if ('quantity' in args) input.quantity = args.quantity;
  if ('rating' in args) input.rating = args.rating;
  if ('notes' in args) input.notes = args.notes;
  return input;
}

export function batchImportInput(args: Record<string, unknown>, source: 'receipt' | 'label_photo'): BatchImportInput {
  return {
    idempotencyKey: args.idempotencyKey,
    source,
    sourceId: args.sourceId,
    items: Array.isArray(args.items) ? args.items.map(importItemInput) : []
  };
}

export function holdInput(args: Record<string, unknown>): HoldInput {
  return { reason: args.reason, ...requiredWriteOptions(args) };
}

export function releaseHoldInput(args: Record<string, unknown>): ReleaseHoldInput {
  return requiredWriteOptions(args);
}

export function recommendationInput(args: Record<string, unknown>): RecommendationInput {
  const input: { occasion?: unknown; limit?: unknown; includeHeld?: unknown } = {};
  if ('occasion' in args) input.occasion = args.occasion;
  if ('limit' in args) input.limit = args.limit;
  if ('includeHeld' in args) input.includeHeld = args.includeHeld;
  return input;
}

export function writeOptions(args: Record<string, unknown>): WriteOptions {
  const idempotencyKey = optionalId(args.idempotencyKey);
  return idempotencyKey === undefined ? {} : { idempotencyKey };
}

export function requiredWriteOptions(args: Record<string, unknown>): WriteOptions {
  const idempotencyKey = optionalId(args.idempotencyKey);
  if (idempotencyKey === undefined) throw new Error('idempotencyKey is required for confirmed write tools');
  return { idempotencyKey };
}

export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

export function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' ? value : undefined;
}

export function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function wineInputFromArgs(args: Record<string, unknown>, requireName: true): AddWineInput;
function wineInputFromArgs(args: Record<string, unknown>, requireName: false): Partial<AddWineInput>;
function wineInputFromArgs(args: Record<string, unknown>, requireName: boolean): AddWineInput | Partial<AddWineInput> {
  const input: Partial<AddWineInput> = {};
  if (requireName || 'name' in args) input.name = stringArg(args, 'name');
  if ('producer' in args) input.producer = args.producer;
  if ('vintage' in args) input.vintage = args.vintage;
  if ('region' in args) input.region = args.region;
  if ('country' in args) input.country = args.country;
  if ('varietal' in args) input.varietal = args.varietal;
  if ('price' in args) input.price = args.price;
  if ('quantity' in args) input.quantity = args.quantity;
  if ('notes' in args) input.notes = args.notes;
  if ('store' in args) input.store = args.store;
  if ('purchaseDate' in args) input.purchaseDate = args.purchaseDate;
  if ('drinkByDate' in args) input.drinkByDate = args.drinkByDate;
  if ('location' in args) input.location = args.location;
  return input;
}

function importItemInput(value: unknown): AddWineInput & { readonly itemKey?: unknown; readonly kind?: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { name: '' };
  const args = value as Record<string, unknown>;
  const input: AddWineInput & { itemKey?: unknown; kind?: unknown } = { ...wineInputFromArgs(args, true) };
  if ('itemKey' in args) input.itemKey = args.itemKey;
  if ('kind' in args) input.kind = args.kind;
  return input;
}
