import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, parseUllageConfig } from './config.js';

test('parseUllageConfig defaults to the sqlite backend with caller supplied path', () => {
  assert.deepEqual(parseUllageConfig({}, '/tmp/default-cellar.db'), { backend: 'sqlite', dbPath: '/tmp/default-cellar.db', appendOnly: false });
  assert.deepEqual(parseUllageConfig({ ULLAGE_BACKEND: '' }, '/tmp/default-cellar.db'), { backend: 'sqlite', dbPath: '/tmp/default-cellar.db', appendOnly: false });
});

test('parseUllageConfig accepts sqlite and lets ULLAGE_DB override the default path', () => {
  assert.deepEqual(parseUllageConfig({ ULLAGE_BACKEND: 'sqlite', ULLAGE_DB: '/tmp/custom.db' }, '/tmp/default-cellar.db'), {
    backend: 'sqlite',
    dbPath: '/tmp/custom.db',
    appendOnly: false
  });
});

test('parseUllageConfig enables append-only SQLite mode from ULLAGE_APPEND_ONLY', () => {
  assert.deepEqual(parseUllageConfig({ ULLAGE_APPEND_ONLY: 'true' }, '/tmp/default-cellar.db'), {
    backend: 'sqlite',
    dbPath: '/tmp/default-cellar.db',
    appendOnly: true
  });
});

test('parseUllageConfig requires ULLAGE_HTTP_BASE_URL for the http backend', () => {
  assert.throws(
    () => parseUllageConfig({ ULLAGE_BACKEND: 'http' }, '/tmp/default-cellar.db'),
    (error: unknown) => error instanceof ConfigError && error.variable === 'ULLAGE_HTTP_BASE_URL' && /ULLAGE_HTTP_BASE_URL/.test(error.message)
  );
  assert.throws(
    () => parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: '   ' }, '/tmp/default-cellar.db'),
    (error: unknown) => error instanceof ConfigError && error.variable === 'ULLAGE_HTTP_BASE_URL'
  );
});

test('parseUllageConfig parses http backend URL, headers, and trailing slash normalization', () => {
  assert.deepEqual(
    parseUllageConfig({
      ULLAGE_BACKEND: 'http',
      ULLAGE_HTTP_BASE_URL: 'https://cellar.example/api///',
      ULLAGE_HTTP_HEADERS: '{"X-Test-Client":"custom-cli","Authorization":"Bearer example"}'
    }, '/tmp/default-cellar.db'),
    {
      backend: 'http',
      baseUrl: 'https://cellar.example/api',
      headers: { 'X-Test-Client': 'custom-cli', Authorization: 'Bearer example' },
      timeoutMs: 10_000
    }
  );
});

test('parseUllageConfig defaults optional http headers to an empty object', () => {
  assert.deepEqual(
    parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: 'https://cellar.example' }),
    { backend: 'http', baseUrl: 'https://cellar.example', headers: {}, timeoutMs: 10_000 }
  );
});

test('parseUllageConfig sets and validates the HTTP request timeout', () => {
  assert.deepEqual(
    parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: 'https://cellar.example' }),
    { backend: 'http', baseUrl: 'https://cellar.example', headers: {}, timeoutMs: 10_000 }
  );
  const custom = parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: 'https://cellar.example', ULLAGE_HTTP_TIMEOUT_MS: '2500' });
  assert.equal(custom.backend, 'http');
  if (custom.backend === 'http') assert.equal(custom.timeoutMs, 2500);
  for (const value of ['0', '-1', 'not-a-number', '300001']) {
    assert.throws(() => parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: 'https://cellar.example', ULLAGE_HTTP_TIMEOUT_MS: value }), /ULLAGE_HTTP_TIMEOUT_MS/);
  }
});

test('parseUllageConfig accepts ULLAGE_STORE as an alias for the http backend', () => {
  assert.deepEqual(
    parseUllageConfig({ ULLAGE_STORE: 'http', ULLAGE_HTTP_BASE_URL: 'https://cellar.example' }),
    { backend: 'http', baseUrl: 'https://cellar.example', headers: {}, timeoutMs: 10_000 }
  );
});

test('parseUllageConfig rejects invalid ULLAGE_HTTP_HEADERS JSON', () => {
  for (const value of ['{', '']) {
    assert.throws(
      () => parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: 'http://127.0.0.1:8080', ULLAGE_HTTP_HEADERS: value }, '/tmp/default-cellar.db'),
      (error: unknown) => error instanceof ConfigError && error.variable === 'ULLAGE_HTTP_HEADERS'
    );
  }
});

test('parseUllageConfig rejects non-object or non-string ULLAGE_HTTP_HEADERS values', () => {
  for (const value of ['[]', 'null', '{"X-Count":1}']) {
    assert.throws(
      () => parseUllageConfig({ ULLAGE_BACKEND: 'http', ULLAGE_HTTP_BASE_URL: 'http://127.0.0.1:8080', ULLAGE_HTTP_HEADERS: value }, '/tmp/default-cellar.db'),
      (error: unknown) => error instanceof ConfigError && error.variable === 'ULLAGE_HTTP_HEADERS'
    );
  }
});

test('parseUllageConfig guides users from the renamed openclaw backend', () => {
  assert.throws(
    () => parseUllageConfig({ ULLAGE_BACKEND: 'openclaw' }, '/tmp/default-cellar.db'),
    (error: unknown) => error instanceof ConfigError
      && error.variable === 'ULLAGE_BACKEND'
      && /renamed to http/.test(error.message)
      && /ULLAGE_HTTP_BASE_URL/.test(error.message)
      && /ULLAGE_HTTP_HEADERS/.test(error.message)
  );
});

test('parseUllageConfig rejects unknown backends with a typed ULLAGE_BACKEND error', () => {
  assert.throws(
    () => parseUllageConfig({ ULLAGE_BACKEND: 'postgres' }, '/tmp/default-cellar.db'),
    (error: unknown) => error instanceof ConfigError && error.variable === 'ULLAGE_BACKEND' && /postgres/.test(error.message)
  );
});
