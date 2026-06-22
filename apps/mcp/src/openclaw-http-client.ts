import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

export type JsonObject = Record<string, unknown>;
export type HttpMethod = 'GET' | 'POST';

export type HttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

const OPENCLAW_CLIENT = 'cli';

export function sendJsonRequest(url: URL, method: HttpMethod, body?: JsonObject): Promise<HttpResponse> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported OpenClaw URL protocol ${url.protocol}`);
  }
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const headers = requestHeaders(bodyText);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<HttpResponse>((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      collectResponse(res).then(
        (text) => resolve({ status: res.statusCode ?? 0, body: parseResponseBody(text) }),
        reject
      );
    });
    req.on('error', reject);
    if (bodyText !== undefined) req.write(bodyText);
    req.end();
  });
}

function requestHeaders(bodyText: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-OpenClaw-Client': OPENCLAW_CLIENT
  };
  if (bodyText !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(bodyText));
  }
  return headers;
}

async function collectResponse(response: IncomingMessage): Promise<string> {
  response.setEncoding('utf8');
  let text = '';
  for await (const chunk of response) {
    if (typeof chunk === 'string') text += chunk;
  }
  return text;
}

function parseResponseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return text;
    throw error;
  }
}
