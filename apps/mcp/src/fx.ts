import { optionalDate } from '@ullage/domain';

export type FxConfig = {
  readonly homeCurrency: string;
  // URL template with {currency} and {date} placeholders. The response must be JSON
  // with a positive numeric `rate`: home-currency units per one unit of {currency}.
  readonly rateUrl: string;
};

export type FxFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

export type PriceConverter = (
  args: Record<string, unknown>,
  fallbackDate?: unknown
) => Promise<Record<string, unknown>>;

const ISO_CURRENCY = /^[A-Z]{3}$/;
const FX_TIMEOUT_MS = 5000;

export function createPriceConverter(
  config: FxConfig | null,
  fetcher: FxFetch = fetch,
  today: () => string = () => new Date().toISOString().slice(0, 10)
): PriceConverter {
  return async (args, fallbackDate) => {
    if (!('currency' in args)) return args;
    const { currency: raw, ...rest } = args;
    const currency = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!ISO_CURRENCY.test(currency)) throw new Error(`currency must be an ISO 4217 code such as "EUR", got ${JSON.stringify(raw)}`);
    const price = rest.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) return rest;
    if (config === null) {
      throw new Error(`price is in ${currency}, but no exchange-rate source is configured (set ULLAGE_HOME_CURRENCY and ULLAGE_FX_RATE_URL)`);
    }
    if (currency === config.homeCurrency) return rest;
    const date = optionalDate(rest.purchaseDate) ?? optionalDate(fallbackDate) ?? today();
    const rate = await fetchRate(config, fetcher, currency, date);
    const line = `Paid ${price} ${currency} (${Number(rate.toFixed(4))} ${config.homeCurrency}/${currency}, ${date})`;
    const notes = typeof rest.notes === 'string' && rest.notes.trim() ? `${rest.notes.trim()}\n${line}` : line;
    return { ...rest, price: Math.round(price * rate), notes };
  };
}

async function fetchRate(config: FxConfig, fetcher: FxFetch, currency: string, date: string): Promise<number> {
  const url = config.rateUrl.replaceAll('{currency}', encodeURIComponent(currency)).replaceAll('{date}', encodeURIComponent(date));
  let body: unknown;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`could not get the ${currency}/${config.homeCurrency} rate for ${date}: ${reason}`);
  }
  const rate = typeof body === 'object' && body !== null ? (body as { readonly rate?: unknown }).rate : undefined;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`the ${currency}/${config.homeCurrency} rate response for ${date} has no positive numeric "rate"`);
  }
  return rate;
}
