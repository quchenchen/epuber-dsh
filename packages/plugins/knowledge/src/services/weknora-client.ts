/**
 * Pure REST client for the WeKnora `/api/v1` surface used by the WorkDSH
 * knowledge plugin.
 *
 * The client owns only transport concerns: the `X-API-Key` header, request
 * timeouts, bounded retries, response-envelope unwrapping, pagination shapes,
 * and normalization into {@link KnowledgeError}. It never logs, stores or
 * returns the API key. Business shaping lives in `knowledge-service.ts`.
 */

/** Error codes exposed through the plugin's host API and agent tools. */
export type KnowledgeErrorCode =
  | 'knowledge/aborted'
  | 'knowledge/bad-request'
  | 'knowledge/conflict'
  | 'knowledge/credential-missing'
  | 'knowledge/forbidden'
  | 'knowledge/invalid-config'
  | 'knowledge/invalid-request'
  | 'knowledge/malformed'
  | 'knowledge/network'
  | 'knowledge/not-found'
  | 'knowledge/rate-limited'
  | 'knowledge/rejected'
  | 'knowledge/timeout'
  | 'knowledge/unauthorized'
  | 'knowledge/unavailable'
  | 'knowledge/upstream';

/** Normalized failure raised by every layer of the plugin. */
export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly status?: number;

  constructor(code: KnowledgeErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'KnowledgeError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface WeKnoraClientOptions {
  /** Deployment origin, for example `http://127.0.0.1:18081`. */
  readonly baseUrl: string;
  /** Tenant API key presented as `X-API-Key`. Never persisted by this client. */
  readonly apiKey: string;
  /** Per-attempt timeout in milliseconds. Defaults to 15000. */
  readonly timeoutMs?: number;
  /** Extra attempts after a transport or 5xx failure. Defaults to 1. */
  readonly retries?: number;
  /** Injection seam for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
}

/** One page of a list response, independent of the upstream envelope shape. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total?: number;
}

/** Truncated binary/inline response used by the file preview endpoint. */
export interface RawResponse {
  readonly status: number;
  readonly contentType?: string;
  readonly contentDisposition?: string;
  readonly contentLength?: number;
  readonly bytes: Uint8Array;
}

export interface QueryValues {
  readonly [key: string]: string | number | boolean | undefined;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestInitInternal {
  readonly query?: QueryValues;
  readonly body?: unknown;
  /** Multipart form (files); mutually exclusive with `body`. */
  readonly formData?: FormData;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  /** Overrides the retry attempt count for this request. */
  readonly retries?: number;
}

export type JsonRecord = Record<string, unknown>;

export const jsonRecord = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;

export const asString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
export const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;
const RETRY_DELAY_MS = 150;
const MAX_DETAIL_CHARS = 400;

const statusMessages: Readonly<Partial<Record<KnowledgeErrorCode, string>>> = {
  'knowledge/bad-request': '知识库请求参数无效。',
  'knowledge/conflict': '知识库资源状态冲突，请刷新后重试。',
  'knowledge/not-found': '知识库资源不存在或当前凭据无权访问。',
  'knowledge/rate-limited': '知识库请求过于频繁，请稍后重试。',
  'knowledge/rejected': '知识库服务拒绝了这次请求。',
  'knowledge/unauthorized': '知识库凭据无效，或当前凭据缺少所需能力。',
  'knowledge/upstream': '知识库服务暂时不可用。',
  'knowledge/malformed': '知识库返回了无法识别的数据。',
} as Readonly<Partial<Record<KnowledgeErrorCode, string>>>;

const detailText = (value: string): string => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;
};

/** Normalize an origin string and reject anything that is not http(s). */
export function normalizeBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new KnowledgeError('knowledge/invalid-config', '知识库服务地址不能为空。');
  let url: URL;
  try { url = new URL(raw); } catch { throw new KnowledgeError('knowledge/invalid-config', '知识库服务地址不是合法的 URL。'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new KnowledgeError('knowledge/invalid-config', '知识库服务地址必须是 http 或 https。');
  if (url.search || url.hash) throw new KnowledgeError('knowledge/invalid-config', '知识库服务地址不能包含查询参数或片段。');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Unwrap the `{ success, data }` envelope the API returns around single
 * resources. Returns the raw value when no envelope is present.
 */
export function readData<T>(value: unknown): T {
  const record = jsonRecord(value);
  if (record && 'data' in record) return record.data as T;
  return value as T;
}

/**
 * Read a list response in any of the shapes the deployment returns:
 * a bare array, `{ data: [] }`, or `{ data: [], page, page_size, total }`
 * (the pagination fields sit beside `data`, not inside it).
 *
 * `{ data: null, success: true }` is how WeKnora reports **zero matches** for a
 * search that ran fine (a knowledge base with no vector/keyword index, or a
 * query nothing scored against). Treating that as malformed turned "no results"
 * into a hard error, so an explicit null `data` is an empty page, not a failure.
 */
export function readPage<T>(value: unknown, fallback: { readonly page?: number; readonly pageSize?: number } = {}): Page<T> {
  const page = fallback.page ?? 1;
  const pageSize = fallback.pageSize ?? 20;
  if (Array.isArray(value)) return { items: value as T[], page, pageSize, total: value.length };
  const record = jsonRecord(value);
  if (!record) throw new KnowledgeError('knowledge/malformed', statusMessages['knowledge/malformed']!);
  if ('data' in record && record.data === null) return { items: [], page, pageSize };
  if ('items' in record && record.items === null) return { items: [], page, pageSize };
  const nested = jsonRecord(record.data);
  const items = Array.isArray(record.data) ? record.data as T[]
    : Array.isArray(record.items) ? record.items as T[]
      : nested && Array.isArray(nested.data) ? nested.data as T[]
        : nested && Array.isArray(nested.items) ? nested.items as T[]
          : undefined;
  if (!items) throw new KnowledgeError('knowledge/malformed', statusMessages['knowledge/malformed']!);
  const resolvedPage = asNumber(record.page) ?? asNumber(nested?.page) ?? page;
  const resolvedSize = asNumber(record.page_size) ?? asNumber(record.pageSize) ?? asNumber(nested?.page_size) ?? asNumber(nested?.pageSize) ?? (items.length || pageSize);
  const total = asNumber(record.total) ?? asNumber(nested?.total);
  return { items, page: resolvedPage, pageSize: resolvedSize, ...(total === undefined ? {} : { total }) };
}

const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));

const parseContentLength = (headers: Headers): number | undefined => {
  const contentRange = headers.get('content-range');
  if (contentRange) {
    const match = /\/(\d+)\s*$/.exec(contentRange);
    if (match) return Number(match[1]);
  }
  const value = headers.get('content-length');
  if (value && /^\d+$/.test(value)) return Number(value);
  return undefined;
};

/** Minimal WeKnora REST client. Construct one per operation with a fresh credential. */
export class WeKnoraClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: WeKnoraClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const apiKey = options.apiKey?.trim();
    if (!apiKey) throw new KnowledgeError('knowledge/credential-missing', '知识库 API Key 未配置。');
    this.apiKey = apiKey;
    this.timeoutMs = Math.min(120_000, Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.retries = Math.min(3, Math.max(0, options.retries ?? DEFAULT_RETRIES));
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  getJson<T>(path: string, query?: QueryValues, signal?: AbortSignal): Promise<T> {
    return this.withRetry(async () => readData<T>(await this.requestJson('GET', path, { ...(query ? { query } : {}), ...(signal ? { signal } : {}) })));
  }

  /** GET a list resource and normalize its pagination envelope. */
  getPage<T>(path: string, query?: QueryValues, signal?: AbortSignal, fallback?: { readonly page?: number; readonly pageSize?: number }): Promise<Page<T>> {
    return this.withRetry(async () => readPage<T>(await this.requestJson('GET', path, { ...(query ? { query } : {}), ...(signal ? { signal } : {}) }), fallback));
  }

  /**
   * POST a JSON body. Writes are not retried by default: replaying a create or
   * upload after an ambiguous timeout could duplicate the resource. Pass
   * `{ retry: true }` only for idempotent POSTs such as search.
   */
  postJson<T>(path: string, body: unknown, signal?: AbortSignal, options: { readonly retry?: boolean } = {}): Promise<T> {
    return this.requestWrite('POST', path, { body, ...(signal ? { signal } : {}) }, options.retry === true);
  }

  /** POST a search request and normalize the hit list (idempotent read). */
  postPage<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Page<T>> {
    return this.withRetry(async () => readPage<T>(await this.requestJson('POST', path, { body, ...(signal ? { signal } : {}) })), this.retries);
  }

  /** PUT a JSON body. Not retried by default; see {@link postJson}. */
  putJson<T>(path: string, body: unknown, signal?: AbortSignal, options: { readonly retry?: boolean } = {}): Promise<T> {
    return this.requestWrite('PUT', path, { body, ...(signal ? { signal } : {}) }, options.retry === true);
  }

  /** DELETE a resource. Not retried by default; see {@link postJson}. */
  deleteJson<T>(path: string, signal?: AbortSignal, options: { readonly retry?: boolean } = {}): Promise<T> {
    return this.requestWrite('DELETE', path, { ...(signal ? { signal } : {}) }, options.retry === true);
  }

  /** POST a multipart form (file upload). Never retried: an upload is not idempotent. */
  postMultipart<T>(path: string, formData: FormData, signal?: AbortSignal): Promise<T> {
    return this.withRetry(async () => readData<T>(await this.requestJson('POST', path, { formData, ...(signal ? { signal } : {}) })), 0);
  }

  private async requestWrite<T>(method: HttpMethod, path: string, init: RequestInitInternal, retry: boolean): Promise<T> {
    return this.withRetry(async () => await this.requestJson(method, path, init) as T, retry ? this.retries : 0);
  }

  /**
   * GET the inline original-file preview endpoint, keeping only the first bytes
   * so a large DOCX/PDF never lands in memory. `Content-Range` supplies the
   * real byte length.
   */
  getRaw(path: string, options: { readonly signal?: AbortSignal; readonly range?: string; readonly maxBytes?: number } = {}): Promise<RawResponse> {
    return this.withRetry(async () => {
      const maxBytes = Math.min(1 << 20, Math.max(256, options.maxBytes ?? 8 * 1024));
      const response = await this.send('GET', path, {
        ...(options.signal ? { signal: options.signal } : {}),
        headers: { accept: '*/*', ...(options.range ? { range: options.range } : {}) },
      });
      if (!response.ok) throw await this.httpError(response, path);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (reader) {
        try {
          while (received < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || !value.byteLength) continue;
            const take = value.byteLength > maxBytes - received ? value.subarray(0, maxBytes - received) : value;
            chunks.push(take);
            received += take.byteLength;
          }
        } finally { await reader.cancel().catch(() => undefined); }
      } else {
        const buffer = new Uint8Array(await response.arrayBuffer());
        chunks.push(buffer.subarray(0, maxBytes));
        received = chunks[0]!.byteLength;
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return {
        status: response.status,
        ...(response.headers.get('content-type') ? { contentType: response.headers.get('content-type')! } : {}),
        ...(response.headers.get('content-disposition') ? { contentDisposition: response.headers.get('content-disposition')! } : {}),
        ...(parseContentLength(response.headers) === undefined ? {} : { contentLength: parseContentLength(response.headers)! }),
        bytes,
      };
    });
  }

  private async withRetry<T>(run: () => Promise<T>, retries = this.retries): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try { return await run(); }
      catch (error) {
        lastError = error;
        if (!this.retryable(error) || attempt === retries) throw error;
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new KnowledgeError('knowledge/upstream', statusMessages['knowledge/upstream']!);
  }

  private retryable(error: unknown): boolean {
    if (!(error instanceof KnowledgeError)) return false;
    if (error.code === 'knowledge/network' || error.code === 'knowledge/timeout' || error.code === 'knowledge/upstream' || error.code === 'knowledge/rate-limited') return true;
    return error.status === 429 || (error.status !== undefined && error.status >= 500 && error.status < 600);
  }

  private async requestJson(method: HttpMethod, path: string, init: RequestInitInternal): Promise<unknown> {
    const response = await this.send(method, path, init);
    if (!response.ok) throw await this.httpError(response, path);
    const text = await response.text();
    if (!text.trim()) return undefined;
    let value: unknown;
    try { value = JSON.parse(text) as unknown; }
    catch { throw new KnowledgeError('knowledge/malformed', `${statusMessages['knowledge/malformed']!}（${path}）`, response.status); }
    const envelope = jsonRecord(value);
    if (envelope && envelope.success === false) {
      throw new KnowledgeError('knowledge/rejected', this.envelopeDetail(envelope) ?? statusMessages['knowledge/rejected']!, response.status);
    }
    return value;
  }

  private async send(method: HttpMethod, path: string, init: RequestInitInternal): Promise<Response> {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${suffix}`);
    for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const headers: Record<string, string> = { 'X-API-Key': this.apiKey, ...(init.headers ?? {}) };
    if (init.formData === undefined && init.body !== undefined) headers['content-type'] = 'application/json';
    // fetch sets the multipart boundary itself; setting a content-type would break it.
    const body = init.formData ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
    try {
      return await this.fetchImpl(url.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body: body as RequestInit['body'] }),
        signal,
      });
    } catch (cause) {
      if (init.signal?.aborted) throw new KnowledgeError('knowledge/aborted', '知识库请求已取消。');
      if (timeout.aborted) throw new KnowledgeError('knowledge/timeout', `知识库服务在 ${this.timeoutMs} 毫秒内未响应。`);
      throw new KnowledgeError('knowledge/network', '无法连接知识库服务，请检查服务地址和网络。');
    }
  }

  private async httpError(response: Response, path: string): Promise<KnowledgeError> {
    let detail: string | undefined;
    try {
      const text = await response.text();
      if (text.trim()) {
        try {
          const parsed = JSON.parse(text) as unknown;
          const record = jsonRecord(parsed);
          detail = record ? this.envelopeDetail(record) ?? (asString(record.message) ?? undefined) : asString(parsed);
        } catch { detail = text; }
      }
    } catch { /* body already consumed or unreadable */ }
    const status = response.status;
    const code: KnowledgeErrorCode = status === 401 || status === 403 ? 'knowledge/unauthorized'
      : status === 404 ? 'knowledge/not-found'
        : status === 409 ? 'knowledge/conflict'
          : status === 429 ? 'knowledge/rate-limited'
            : status >= 500 ? 'knowledge/upstream'
              : 'knowledge/bad-request';
    const base = statusMessages[code] ?? '知识库请求失败。';
    const message = detail ? `${base}（${detailText(detail)}）` : `${base}（HTTP ${status}，${path}）`;
    return new KnowledgeError(code, message, status);
  }

  private envelopeDetail(envelope: JsonRecord): string | undefined {
    for (const candidate of [envelope.message, envelope.error, jsonRecord(envelope.error)?.message, jsonRecord(envelope.data)?.message]) {
      const text = asString(candidate);
      if (text?.trim()) return text;
    }
    return undefined;
  }
}
