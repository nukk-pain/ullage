import { optionalDate } from '@ullage/domain';

export type FxConfig = {
  readonly homeCurrency: string;
  // URL template with {currency} and {date} placeholders. The response must be JSON
  // with a positive numeric `rate`: home-currency units per one unit of {currency}.
  readonly rateUrl: string | null;
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

export type ExchangeRate = {
  readonly rate: number;
  readonly homeCurrency: string;
  readonly rateDate: string;
  readonly source: string;
};

export type ExchangeRateLookup = (currency: string, date?: string) => Promise<ExchangeRate>;

export type FxService = {
  readonly convertPrice: PriceConverter;
  readonly getExchangeRate: ExchangeRateLookup;
};

type RateRequest = {
  readonly config: FxConfig;
  readonly currency: string;
  readonly date: string;
};

const ISO_CURRENCY = /^[A-Z]{3}$/;
const FX_TIMEOUT_MS = 5000;
const FRANKFURTER_ECB_RATES_URL = 'https://api.frankfurter.dev/v2/providers/ecb/rates';
const RATE_LOOKBACK_DAYS = 10;
const FRANKFURTER_SOURCE = 'Frankfurter (ECB)';
const CUSTOM_SOURCE = 'configured ULLAGE_FX_RATE_URL';

export function createFxService(
  config: FxConfig | null,
  fetcher: FxFetch = fetch,
  today: () => string = () => new Date().toISOString().slice(0, 10)
): FxService {
  const cache = new Map<string, Promise<ExchangeRate>>();

  const getExchangeRate: ExchangeRateLookup = async (rawCurrency, rawDate) => {
    const currency = normalizeCurrency(rawCurrency);
    const date = normalizeDate(rawDate ?? today());
    if (config === null) throw new Error('No home currency is configured; set ULLAGE_HOME_CURRENCY to enable exchange-rate lookup.');
    if (currency === config.homeCurrency) {
      return { rate: 1, homeCurrency: config.homeCurrency, rateDate: date, source: 'same currency' };
    }

    const key = `${currency}\u0000${date}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const pending = fetchRate({ config, currency, date }, fetcher).catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    return pending;
  };

  const convertPrice: PriceConverter = async (args, fallbackDate) => {
    if (!('currency' in args)) return args;
    const { currency: raw, ...rest } = args;
    const currency = normalizeCurrency(raw);
    const price = rest.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) return rest;
    if (config === null) throw missingFxConfig(currency);
    if (currency === config.homeCurrency) return rest;
    const date = optionalDate(rest.purchaseDate) ?? optionalDate(fallbackDate) ?? today();
    const exchange = await getExchangeRate(currency, date);
    const line = `Paid ${price} ${currency} (${Number(exchange.rate.toFixed(4))} ${exchange.homeCurrency}/${currency}, ${exchange.rateDate}; source: ${exchange.source})`;
    const notes = typeof rest.notes === 'string' && rest.notes.trim() ? `${rest.notes.trim()}\n${line}` : line;
    return { ...rest, price: Math.round(price * exchange.rate), notes };
  };

  return { convertPrice, getExchangeRate };
}

export function createPriceConverter(
  config: FxConfig | null,
  fetcher: FxFetch = fetch,
  today: () => string = () => new Date().toISOString().slice(0, 10)
): PriceConverter {
  return createFxService(config, fetcher, today).convertPrice;
}

async function fetchRate(request: RateRequest, fetcher: FxFetch): Promise<ExchangeRate> {
  const { config, currency, date } = request;
  const usesBuiltin = config.rateUrl === null;
  const url = usesBuiltin ? frankfurterUrl(request) : config.rateUrl.replaceAll('{currency}', encodeURIComponent(currency)).replaceAll('{date}', encodeURIComponent(date));
  let body: unknown;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`could not get the ${currency}/${config.homeCurrency} rate for ${date}: ${reason}`);
  }

  if (usesBuiltin) return parseFrankfurterRates(body, request);

  const record = isRecord(body) ? body : null;
  const rate = record?.rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`the ${currency}/${config.homeCurrency} rate response for ${date} has no positive numeric "rate"`);
  }
  const rawRateDate = record?.date ?? record?.rateDate;
  const rateDate = rawRateDate === undefined ? date : normalizeDateValue(rawRateDate);
  return {
    rate,
    homeCurrency: config.homeCurrency,
    rateDate,
    source: CUSTOM_SOURCE
  };
}

function frankfurterUrl(request: RateRequest): string {
  const { config, currency, date } = request;
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - RATE_LOOKBACK_DAYS);
  const query = new URLSearchParams({
    from: start.toISOString().slice(0, 10),
    to: date,
    base: currency.toLowerCase(),
    quotes: config.homeCurrency.toLowerCase()
  });
  return `${FRANKFURTER_ECB_RATES_URL}?${query}`;
}

function parseFrankfurterRates(body: unknown, request: RateRequest): ExchangeRate {
  const { config, currency, date: requestedDate } = request;
  const { homeCurrency } = config;
  if (!Array.isArray(body)) throw new Error(`the ${currency}/${homeCurrency} rate response for ${requestedDate} must be a JSON array`);
  const rows = body.filter(isRecord);
  const eligible = rows.flatMap((row) => {
    if (typeof row.base !== 'string' || row.base.toUpperCase() !== currency || typeof row.quote !== 'string' || row.quote.toUpperCase() !== homeCurrency) return [];
    const rateDate = normalizeDateValue(row.date);
    const rate = row.rate;
    if (rateDate > requestedDate || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return [];
    return [{ rate, rateDate }];
  });
  eligible.sort((a, b) => b.rateDate.localeCompare(a.rateDate));
  const result = eligible[0];
  if (result === undefined) throw new Error(`the Frankfurter ECB response has no ${currency}/${homeCurrency} rate on or before ${requestedDate}`);
  return { ...result, homeCurrency, source: FRANKFURTER_SOURCE };
}

function normalizeCurrency(value: unknown): string {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ISO_CURRENCY.test(currency)) throw new Error(`currency must be an ISO 4217 code such as "EUR", got ${JSON.stringify(value)}`);
  return currency;
}

function normalizeDate(value: string): string {
  const normalized = normalizeDateValue(value);
  if (normalized !== value) throw new Error(`date must be a valid YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  return normalized;
}

function normalizeDateValue(value: unknown): string {
  const date = optionalDate(value);
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`date must be a valid YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`date must be a valid YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
  return date;
}

function missingFxConfig(currency: string): Error {
  return new Error(`price is in ${currency}, but no home currency is configured (set ULLAGE_HOME_CURRENCY; ULLAGE_FX_RATE_URL is optional)`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
