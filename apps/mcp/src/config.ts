import { homedir } from 'node:os';
import { join } from 'node:path';

export type UllageConfig =
  | {
      readonly backend: 'sqlite';
      readonly dbPath: string;
      readonly appendOnly: boolean;
    }
  | {
      readonly backend: 'openclaw';
      readonly baseUrl: string;
    };

export type UllageEnv = {
  readonly ULLAGE_BACKEND?: string;
  readonly ULLAGE_STORE?: string;
  readonly ULLAGE_DB?: string;
  readonly ULLAGE_APPEND_ONLY?: string;
  readonly ULLAGE_OPENCLAW_BASE_URL?: string;
};

const DEFAULT_OPENCLAW_BASE_URL = 'http://localhost:6744/wine/api/localhost';

export class ConfigError extends Error {
  readonly name = 'ConfigError';

  constructor(readonly variable: string, message: string) {
    super(message);
  }
}

export function createDefaultSqlitePath(): string {
  return join(homedir(), '.ullage', 'cellar.db');
}

export function parseUllageConfig(env: UllageEnv, defaultSqlitePath = createDefaultSqlitePath()): UllageConfig {
  const backendVariable = backendEnvVariable(env);
  const backend = backendVariable.value;
  switch (backend) {
    case '':
    case 'sqlite':
      return { backend: 'sqlite', dbPath: sqlitePath(env, defaultSqlitePath), appendOnly: appendOnly(env) };
    case 'openclaw':
      return { backend: 'openclaw', baseUrl: openClawBaseUrl(env) };
    default:
      throw new ConfigError(backendVariable.name, `Unsupported ${backendVariable.name} ${backend}. Supported backends: sqlite, openclaw.`);
  }
}

function backendEnvVariable(env: UllageEnv): { readonly name: 'ULLAGE_BACKEND' | 'ULLAGE_STORE'; readonly value: string } {
  const store = env.ULLAGE_STORE?.trim();
  if (store !== undefined && store.length > 0) return { name: 'ULLAGE_STORE', value: store };
  return { name: 'ULLAGE_BACKEND', value: env.ULLAGE_BACKEND?.trim() ?? '' };
}

function sqlitePath(env: UllageEnv, defaultSqlitePath: string): string {
  const configured = env.ULLAGE_DB?.trim();
  return configured && configured.length > 0 ? configured : defaultSqlitePath;
}

function openClawBaseUrl(env: UllageEnv): string {
  const configured = env.ULLAGE_OPENCLAW_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured.replace(/\/+$/, '') : DEFAULT_OPENCLAW_BASE_URL;
}

function appendOnly(env: UllageEnv): boolean {
  const configured = env.ULLAGE_APPEND_ONLY?.trim().toLowerCase();
  return configured === '1' || configured === 'true' || configured === 'yes';
}
