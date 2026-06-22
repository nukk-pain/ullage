import type { CellarStore } from './cellar-store.js';
import type { UllageConfig } from './config.js';
import { OpenClawHttpCellarStore } from './openclaw-http-cellar-store.js';
import { SqliteCellarStore } from './store.js';

export function createCellarStore(config: UllageConfig): CellarStore {
  switch (config.backend) {
    case 'sqlite':
      return new SqliteCellarStore(config.dbPath, { appendOnly: config.appendOnly });
    case 'openclaw':
      return new OpenClawHttpCellarStore(config.baseUrl);
  }
}
