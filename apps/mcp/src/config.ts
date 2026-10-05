import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FxConfig } from './fx.js';

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
  readonly ULLAGE_HOME_CURRENCY?: string;
  readonly ULLAGE_FX_RATE_URL?: string;
};

const DEFAULT_OPENCLAW_BASE_URL = 'http://localhost:8080/cellar';

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

export function parseFxConfig(env: UllageEnv): FxConfig | null {
  const homeCurrency = env.ULLAGE_HOME_CURRENCY?.trim().toUpperCase() ?? '';
  const rateUrl = env.ULLAGE_FX_RATE_URL?.trim() ?? '';
  if (homeCurrency === '' && rateUrl === '') return null;
  if (!/^[A-Z]{3}$/.test(homeCurrency)) {
    throw new ConfigError('ULLAGE_HOME_CURRENCY', 'ULLAGE_HOME_CURRENCY must be an ISO 4217 code such as KRW when ULLAGE_FX_RATE_URL is set.');
  }
  if (!/^https?:\/\//.test(rateUrl) || !rateUrl.includes('{currency}')) {
    throw new ConfigError('ULLAGE_FX_RATE_URL', 'ULLAGE_FX_RATE_URL must be an http(s) URL containing {currency} (and optionally {date}) when ULLAGE_HOME_CURRENCY is set.');
  }
  return { homeCurrency, rateUrl };
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
