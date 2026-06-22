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

test('parseUllageConfig returns the openclaw backend with the default local wine API URL', () => {
  assert.deepEqual(parseUllageConfig({ ULLAGE_BACKEND: 'openclaw' }, '/tmp/default-cellar.db'), {
    backend: 'openclaw',
    baseUrl: 'http://localhost:6744/wine/api/localhost'
  });
});

test('parseUllageConfig lets ULLAGE_OPENCLAW_BASE_URL override the default local wine API URL', () => {
  assert.deepEqual(
    parseUllageConfig({ ULLAGE_BACKEND: 'openclaw', ULLAGE_OPENCLAW_BASE_URL: 'http://127.0.0.1:6744/custom' }, '/tmp/default-cellar.db'),
    {
      backend: 'openclaw',
      baseUrl: 'http://127.0.0.1:6744/custom'
    }
  );
});

test('parseUllageConfig accepts ULLAGE_STORE as an alias for the openclaw backend', () => {
  assert.deepEqual(parseUllageConfig({ ULLAGE_STORE: 'openclaw' }, '/tmp/default-cellar.db'), {
    backend: 'openclaw',
    baseUrl: 'http://localhost:6744/wine/api/localhost'
  });
});

test('parseUllageConfig rejects unknown backends with a typed ULLAGE_BACKEND error', () => {
  assert.throws(
    () => parseUllageConfig({ ULLAGE_BACKEND: 'postgres' }, '/tmp/default-cellar.db'),
    (error: unknown) => error instanceof ConfigError && error.variable === 'ULLAGE_BACKEND' && /postgres/.test(error.message)
  );
});
