import test from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createCellarStore } from './store-factory.js';
import { SqliteCellarStore } from './store.js';

test('createCellarStore creates the default sqlite adapter without network configuration', async () => {
  const dbPath = join(tmpdir(), `ullage-factory-${randomUUID()}.db`);
  const store = createCellarStore({ backend: 'sqlite', dbPath, appendOnly: false });

  const wine = await store.addWine({ name: 'Factory Riesling', quantity: 1 });
  assert.equal(wine.name, 'Factory Riesling');
  assert.equal((await store.summary()).bottle_count, 1);

  await store.close();
  await unlink(dbPath);
});

test('createCellarStore returns a non-sqlite cellar store for the openclaw backend', async () => {
  const store = createCellarStore({ backend: 'openclaw', baseUrl: 'http://127.0.0.1:1' });

  assert.equal(typeof store.addWine, 'function');
  assert.equal(store instanceof SqliteCellarStore, false);

  await store.close();
});
