import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FxConfig } from './fx.js';
import type { HttpHeaders } from './http-cellar-client.js';

export type UllageConfig =
  | {
      readonly backend: 'sqlite';
      readonly dbPath: string;
      readonly appendOnly: boolean;
    }
  | {
      readonly backend: 'http';
      readonly baseUrl: string;
      readonly headers: HttpHeaders;
      readonly timeoutMs: number;
    };

export type UllageEnv = {
  readonly ULLAGE_BACKEND?: string;
  readonly ULLAGE_STORE?: string;
  readonly ULLAGE_DB?: string;
  readonly ULLAGE_APPEND_ONLY?: string;
  readonly ULLAGE_HTTP_BASE_URL?: string;
  readonly ULLAGE_HTTP_HEADERS?: string;
  readonly ULLAGE_HTTP_TIMEOUT_MS?: string;
  readonly ULLAGE_HOME_CURRENCY?: string;
  readonly ULLAGE_FX_RATE_URL?: string;
};

const LEGACY_BACKEND = ['open', 'claw'].join('');

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
    case LEGACY_BACKEND:
      throw new ConfigError(backendVariable.name, 'The openclaw backend was renamed to http; set ULLAGE_BACKEND=http and ULLAGE_HTTP_BASE_URL (and ULLAGE_HTTP_HEADERS if your server needs a client header).');
    case 'http':
      return { backend: 'http', baseUrl: httpBaseUrl(env), headers: httpHeaders(env), timeoutMs: httpTimeoutMs(env) };
    default:
      throw new ConfigError(backendVariable.name, `Unsupported ${backendVariable.name} ${backend}. Supported backends: sqlite, http.`);
  }
}

export function parseFxConfig(env: UllageEnv): FxConfig | null {
  const homeCurrency = env.ULLAGE_HOME_CURRENCY?.trim().toUpperCase() ?? '';
  const rateUrl = env.ULLAGE_FX_RATE_URL?.trim() ?? '';
  if (homeCurrency === '' && rateUrl === '') return null;
  if (!/^[A-Z]{3}$/.test(homeCurrency)) {
    throw new ConfigError('ULLAGE_HOME_CURRENCY', 'Set ULLAGE_HOME_CURRENCY to an ISO 4217 code such as KRW; ULLAGE_FX_RATE_URL is optional.');
  }
  if (rateUrl !== '' && (!/^https?:\/\//.test(rateUrl) || !rateUrl.includes('{currency}'))) {
    throw new ConfigError('ULLAGE_FX_RATE_URL', 'ULLAGE_FX_RATE_URL must be an http(s) URL containing {currency} (and optionally {date}) when ULLAGE_HOME_CURRENCY is set.');
  }
  return { homeCurrency, rateUrl: rateUrl || null };
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

function httpBaseUrl(env: UllageEnv): string {
  const configured = env.ULLAGE_HTTP_BASE_URL?.trim();
  if (!configured) throw new ConfigError('ULLAGE_HTTP_BASE_URL', 'ULLAGE_HTTP_BASE_URL is required when ULLAGE_BACKEND=http.');
  return configured.replace(/\/+$/, '');
}

function httpHeaders(env: UllageEnv): HttpHeaders {
  const configured = env.ULLAGE_HTTP_HEADERS;
  if (configured === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new ConfigError('ULLAGE_HTTP_HEADERS', 'ULLAGE_HTTP_HEADERS must be a JSON object with string values.');
    }
    throw error;
  }

  if (!isUnknownRecord(parsed)) {
    throw new ConfigError('ULLAGE_HTTP_HEADERS', 'ULLAGE_HTTP_HEADERS must be a JSON object with string values.');
  }

  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new ConfigError('ULLAGE_HTTP_HEADERS', 'ULLAGE_HTTP_HEADERS must be a JSON object with string values.');
    }
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

function httpTimeoutMs(env: UllageEnv): number {
  const configured = env.ULLAGE_HTTP_TIMEOUT_MS?.trim();
  if (!configured) return 10_000;
  if (!/^\d+$/.test(configured)) throw new ConfigError('ULLAGE_HTTP_TIMEOUT_MS', 'ULLAGE_HTTP_TIMEOUT_MS must be an integer from 1 to 300000.');
  const timeoutMs = Number(configured);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new ConfigError('ULLAGE_HTTP_TIMEOUT_MS', 'ULLAGE_HTTP_TIMEOUT_MS must be an integer from 1 to 300000.');
  }
  return timeoutMs;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendOnly(env: UllageEnv): boolean {
  const configured = env.ULLAGE_APPEND_ONLY?.trim().toLowerCase();
  return configured === '1' || configured === 'true' || configured === 'yes';
}
