import type { ExchangeRateLookup } from './fx.js';
import type { McpTool } from './mcp.js';
import { stringArg } from './tool-inputs.js';

export function createFxTools(lookup?: ExchangeRateLookup): McpTool[] {
  return [
    {
      name: 'get_exchange_rate',
      description: 'Get the home-currency units per one unit of a foreign currency for a date. The result includes the provider observation date and source.',
      inputSchema: {
        type: 'object',
        properties: {
          currency: { type: 'string', description: 'ISO 4217 currency code, e.g. EUR' },
          date: { type: 'string', description: 'Optional YYYY-MM-DD date; defaults to today' }
        },
        required: ['currency'],
        additionalProperties: false
      },
      handler: async (args) => {
        if (lookup === undefined) {
          throw new Error('No home currency is configured; set ULLAGE_HOME_CURRENCY to enable exchange-rate lookup.');
        }
        const date = args.date;
        if (date !== undefined && typeof date !== 'string') throw new Error('date must be a YYYY-MM-DD string');
        return lookup(stringArg(args, 'currency'), date);
      }
    }
  ];
}
