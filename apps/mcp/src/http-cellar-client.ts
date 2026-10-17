import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

export type JsonObject = Record<string, unknown>;
export type HttpMethod = 'GET' | 'POST';

export type HttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

export type HttpHeaders = Readonly<Record<string, string>>;

export type JsonRequestOptions = {
  readonly body: JsonObject | undefined;
  readonly headers: HttpHeaders;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
};

export const HTTP_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

export function sendJsonRequest(url: URL, method: HttpMethod, options: JsonRequestOptions): Promise<HttpResponse> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported HTTP URL protocol ${url.protocol}`);
  }
  const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers = requestHeaders(bodyText, options.headers);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? HTTP_RESPONSE_MAX_BYTES;

  return new Promise<HttpResponse>((resolve, reject) => {
    const req = request(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      collectResponse(res, maxResponseBytes).then(
        (text) => resolve({ status: res.statusCode ?? 0, body: parseResponseBody(text) }),
        reject
      );
    });
    req.on('error', reject);
    if (bodyText !== undefined) req.write(bodyText);
    req.end();
  });
}

function requestHeaders(bodyText: string | undefined, additionalHeaders: HttpHeaders): Record<string, string> {
  const headers = Object.fromEntries(
    Object.entries(additionalHeaders).filter(([name]) => !['accept', 'content-type', 'content-length'].includes(name.toLowerCase()))
  );
  headers.Accept = 'application/json';
  if (bodyText !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(bodyText));
  }
  return headers;
}

async function collectResponse(response: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) {
      response.destroy();
      throw new Error(`HTTP response exceeded ${maxBytes} byte limit`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
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
