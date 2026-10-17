import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddWineInput, BatchImportInput } from '@ullage/domain';
import type { CellarStore } from './cellar-store.js';
import { ConfigError, parseFxConfig } from './config.js';
import { createFxService, createPriceConverter, type FxFetch } from './fx.js';
import { createUllageTools } from './tools.js';

const templateUrl = 'http://fx.test/lookup?currencyCode={currency}&date={date}';
const config = { homeCurrency: 'KRW', rateUrl: templateUrl };
const builtinConfig = { homeCurrency: 'KRW', rateUrl: null };

function rateFetcher(body: unknown, urls: string[] = [], ok = true): FxFetch {
  return async (url) => {
    urls.push(url);
    return { ok, status: ok ? 200 : 404, json: async () => body };
  };
}

test('built-in provider parses the actual observation date for a weekend request', async () => {
  const urls: string[] = [];
  const fx = createFxService(builtinConfig, rateFetcher([{ date: '2026-10-16', base: 'EUR', quote: 'KRW', rate: 1700.125 }], urls));

  const result = await fx.getExchangeRate('eur', '2026-10-17');

  assert.deepEqual(result, { rate: 1700.125, homeCurrency: 'KRW', rateDate: '2026-10-16', source: 'Frankfurter (ECB)' });
  assert.deepEqual(urls, ['https://api.frankfurter.dev/v2/providers/ecb/rates?from=2026-10-07&to=2026-10-17&base=eur&quotes=krw']);
});

test('foreign price uses the provider observation date and identifies the source in notes', async () => {
  const urls: string[] = [];
  const convert = createPriceConverter(builtinConfig, rateFetcher([{ date: '2026-10-02', base: 'CHF', quote: 'KRW', rate: 1621.4596421856907 }], urls));
  const out = await convert({ name: 'Merlot Ticino', price: 15, currency: 'chf', purchaseDate: '2026-10-04', notes: '50 cl' });
  assert.deepEqual(out, {
    name: 'Merlot Ticino',
    price: 24322,
    purchaseDate: '2026-10-04',
    notes: '50 cl\nPaid 15 CHF (1621.4596 KRW/CHF, 2026-10-02; source: Frankfurter (ECB))'
  });
  assert.deepEqual(urls, ['https://api.frankfurter.dev/v2/providers/ecb/rates?from=2026-09-24&to=2026-10-04&base=chf&quotes=krw']);
});

test('batch purchase date is used when the item has none, then today', async () => {
  const urls: string[] = [];
  const convert = createPriceConverter(config, rateFetcher({ rate: 10 }, urls), () => '2026-10-05');
  assert.equal((await convert({ name: 'A', price: 2, currency: 'EUR' }, '2026-09-01')).price, 20);
  assert.equal((await convert({ name: 'B', price: 3, currency: 'EUR' })).notes, 'Paid 3 EUR (10 KRW/EUR, 2026-10-05; source: configured ULLAGE_FX_RATE_URL)');
  assert.deepEqual(urls.map((url) => url.slice(-10)), ['2026-09-01', '2026-10-05']);
});

test('same currency and date share one cached request', async () => {
  const urls: string[] = [];
  const fx = createFxService(builtinConfig, rateFetcher([{ date: '2026-10-16', base: 'EUR', quote: 'KRW', rate: 1700 }], urls));

  const first = await fx.getExchangeRate('EUR', '2026-10-17');
  const second = await fx.getExchangeRate('EUR', '2026-10-17');

  assert.deepEqual(second, first);
  assert.equal(urls.length, 1);
});

test('failed requests are not cached and can be retried', async () => {
  let calls = 0;
  const fx = createFxService(builtinConfig, async () => {
    calls += 1;
    throw new Error('offline');
  });

  await assert.rejects(fx.getExchangeRate('EUR', '2026-10-16'), /could not get the EUR\/KRW rate .*offline/);
  await assert.rejects(fx.getExchangeRate('EUR', '2026-10-16'), /could not get the EUR\/KRW rate .*offline/);
  assert.equal(calls, 2);
});

test('configured rate URL takes precedence and exposes its returned rate date', async () => {
  const urls: string[] = [];
  const fx = createFxService(config, rateFetcher({ rate: 1500, date: '2026-10-02' }, urls));

  const result = await fx.getExchangeRate('EUR', '2026-10-04');

  assert.deepEqual(result, { rate: 1500, homeCurrency: 'KRW', rateDate: '2026-10-02', source: 'configured ULLAGE_FX_RATE_URL' });
  assert.deepEqual(urls, ['http://fx.test/lookup?currencyCode=EUR&date=2026-10-04']);
});

test('home currency, missing currency, and missing price never call the rate source', async () => {
  const convert = createPriceConverter(config, async () => { throw new Error('must not fetch'); });
  assert.deepEqual(await convert({ name: 'A', price: 39990, currency: 'KRW' }), { name: 'A', price: 39990 });
  assert.deepEqual(await convert({ name: 'B', price: 39990 }), { name: 'B', price: 39990 });
  assert.deepEqual(await convert({ name: 'C', currency: 'CHF' }), { name: 'C' });
});

test('a foreign price is rejected rather than stored unconverted', async () => {
  await assert.rejects(createPriceConverter(null)({ name: 'A', price: 15, currency: 'CHF' }), /no home currency is configured/);
  await assert.rejects(createPriceConverter(config, rateFetcher({ rate: 1 }, [], false))({ name: 'A', price: 15, currency: 'CHF' }), /could not get the CHF\/KRW rate for .*HTTP 404/);
  await assert.rejects(createPriceConverter(config, rateFetcher({ rate: 0 }))({ name: 'A', price: 15, currency: 'CHF' }), /no positive numeric "rate"/);
  await assert.rejects(createPriceConverter(config, rateFetcher(1))({ name: 'A', price: 15, currency: 'Swiss franc' }), /ISO 4217/);
  await assert.rejects(createPriceConverter(config, rateFetcher({ rate: 1 }))({ name: 'A', price: '24.50', currency: 'CHF' }), /price must be a finite number/);
});

test('parseFxConfig defaults to Frankfurter when only the home currency is set', () => {
  assert.equal(parseFxConfig({}), null);
  assert.deepEqual(parseFxConfig({ ULLAGE_HOME_CURRENCY: 'krw' }), builtinConfig);
  assert.deepEqual(parseFxConfig({ ULLAGE_HOME_CURRENCY: 'krw', ULLAGE_FX_RATE_URL: templateUrl }), config);
  assert.throws(() => parseFxConfig({ ULLAGE_FX_RATE_URL: config.rateUrl }), ConfigError);
  assert.throws(() => parseFxConfig({ ULLAGE_HOME_CURRENCY: 'KRW', ULLAGE_FX_RATE_URL: 'http://fx.test/lookup' }), ConfigError);
});

test('add_wine and receipt import store converted home-currency prices', async () => {
  const added: AddWineInput[] = [];
  const imported: BatchImportInput[] = [];
  const store = {
    addWine: async (input: AddWineInput) => { added.push(input); return input; },
    importWines: async (input: BatchImportInput) => { imported.push(input); return input; }
  } as unknown as CellarStore;
  const tools = createUllageTools(store, createPriceConverter(config, rateFetcher({ rate: 1500, date: '2026-10-04' })));
  const call = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args);

  await call('add_wine', { name: 'Merlot', price: 15, currency: 'CHF', purchaseDate: '2026-10-04', idempotencyKey: 'k1' });
  await call('import_receipt_wines', { idempotencyKey: 'k2', purchaseDate: '2026-10-04', items: [{ name: 'Fendant', price: 20, currency: 'CHF' }, { name: 'Soju', price: 1800 }] });

  assert.deepEqual(added, [{ name: 'Merlot', price: 22500, purchaseDate: '2026-10-04', notes: 'Paid 15 CHF (1500 KRW/CHF, 2026-10-04; source: configured ULLAGE_FX_RATE_URL)' }]);
  assert.deepEqual(imported[0]?.items, [
    { name: 'Fendant', price: 30000, notes: 'Paid 20 CHF (1500 KRW/CHF, 2026-10-04; source: configured ULLAGE_FX_RATE_URL)' },
    { name: 'Soju', price: 1800 }
  ]);
});
