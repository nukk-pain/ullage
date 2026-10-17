import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { SqliteCellarStore } from './store.js';

const [dbPath, gatePath] = process.argv.slice(2);
if (!dbPath || !gatePath) throw new Error('expected database and gate paths');

process.stdout.write('READY\n');
while (!existsSync(gatePath)) await delay(5);

try {
  const store = new SqliteCellarStore(dbPath);
  const wineCount = store.listWines().length;
  store.close();
  process.stdout.write(`OK ${wineCount}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
