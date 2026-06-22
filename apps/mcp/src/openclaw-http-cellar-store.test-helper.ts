import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Wine } from '@ullage/domain';

export type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly openClawClient: string | undefined;
  readonly secFetchMode: string | undefined;
  readonly body: string;
};

type FakeOpenClawServer = {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  readonly close: () => Promise<void>;
};

type FakeHandler = (request: RecordedRequest) => { readonly status: number; readonly body: unknown };

export const serviceWine = {
  id: 'wine-1', name: 'Chablis', vintage: '2020', producer: 'Raveneau',
  region: 'Burgundy', country: 'France', varietal: 'Chardonnay',
  price: 90, quantity: 2, store: 'K&L',
  purchaseDate: '2026-01-02T00:00:00.000Z',
  status: 'In Stock', rating: 4.5, notes: 'mineral',
  createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z'
};

export const mappedWine: Wine = {
  id: 'wine-1', name: 'Chablis', producer: 'Raveneau', vintage: 2020,
  region: 'Burgundy', country: 'France', varietal: 'Chardonnay',
  price: 90, quantity: 2, rating: 4.5, notes: 'mineral', store: 'K&L',
  purchaseDate: '2026-01-02T00:00:00.000Z',
  drinkByDate: null, location: null,
  createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z'
};

export async function startFakeOpenClawServer(handler: FakeHandler): Promise<FakeOpenClawServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    void handleRequest(request, response, requests, handler);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fake OpenClaw server did not bind a TCP port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

export function requestSummary(requests: readonly RecordedRequest[]): Array<Omit<RecordedRequest, 'body' | 'secFetchMode'>> {
  assert.deepEqual(requests.map((request) => request.secFetchMode), requests.map(() => undefined));
  return requests.map((request) => ({ method: request.method, path: request.path, openClawClient: request.openClawClient }));
}

export function onlyRequest(requests: readonly RecordedRequest[]): RecordedRequest {
  assert.equal(requests.length, 1);
  const [request] = requests;
  if (request === undefined) throw new Error('Expected one recorded request');
  return request;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RecordedRequest[],
  handler: FakeHandler
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const recordedRequest: RecordedRequest = {
    method: request.method ?? '',
    path: `${url.pathname}${url.search}`,
    openClawClient: singleHeader(request.headers['x-openclaw-client']),
    secFetchMode: singleHeader(request.headers['sec-fetch-mode']),
    body: await readBody(request)
  };
  requests.push(recordedRequest);
  const fakeResponse = handler(recordedRequest);
  response.writeHead(fakeResponse.status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(fakeResponse.body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request) {
    if (typeof chunk === 'string') body += chunk;
  }
  return body;
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  return value?.[0];
}
