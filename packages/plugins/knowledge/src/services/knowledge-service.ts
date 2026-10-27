import { Context, Service } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import type { ActorContext } from 'workdsh-contracts';
import {
  KnowledgeError,
  WeKnoraClient,
  asNumber,
  asString,
  jsonRecord,
  normalizeBaseUrl,
  type FetchLike,
  type Page,
} from './weknora-client.js';
import {
  DEFAULT_API_KEY_REF,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  knowledgeDomainSpec,
  knowledgeStateKey,
  type KnowledgeConnection,
  type KnowledgeConnectionState,
} from '../storage/domain.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshKnowledge: KnowledgeService; } }

const API = '/api/v1';
const MAX_PAGE_SIZE = 100;
const MAX_MATCH_COUNT = 20;
const MAX_READ_LIMIT = 20_000;
const MAX_READ_PAGES = 10;
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** How a document's parse pipeline currently stands. */
export type KnowledgeParseStatus = 'completed' | 'processing' | 'pending' | 'failed' | 'unknown';
export type KnowledgeSearchMode = 'hybrid' | 'semantic' | 'keyword';

export interface KnowledgeBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly knowledgeCount: number;
  readonly type?: string;
  readonly updatedAt?: string;
}

export interface KnowledgeDocument {
  readonly id: string;
  readonly knowledgeBaseId: string;
  readonly knowledgeBaseName?: string;
  readonly title: string;
  readonly fileName?: string;
  readonly fileType?: string;
  readonly parseStatus: KnowledgeParseStatus;
  readonly parseStatusLabel: string;
  readonly errorMessage?: string;
  readonly description?: string;
  readonly sizeBytes?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface KnowledgeChunk {
  readonly id: string;
  readonly knowledgeId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly startAt?: number;
  readonly endAt?: number;
}

export interface KnowledgeSearchHit {
  readonly chunkId: string;
  readonly knowledgeId: string;
  readonly knowledgeTitle: string;
  readonly knowledgeBaseId: string;
  readonly score: number;
  readonly content: string;
  readonly chunkIndex?: number;
}

export interface KnowledgePreview {
  readonly knowledgeId: string;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly byteLength?: number;
  /** Plain text preview taken from the original file when it is textual, otherwise from parsed chunks. */
  readonly text: string;
  readonly source: 'original' | 'parsed';
  readonly truncated: boolean;
}

export interface KnowledgeReadResult {
  readonly knowledgeId: string;
  readonly knowledgeBaseId?: string;
  readonly title: string;
  readonly content: string;
  readonly offset: number;
  readonly nextOffset?: number;
  readonly truncated: boolean;
}

export interface KnowledgeSearchInput {
  readonly query: string;
  readonly kbId?: string;
  readonly matchCount?: number;
  readonly mode?: KnowledgeSearchMode;
}

export interface KnowledgeSettings {
  readonly baseUrl: string;
  readonly defaultKbId?: string;
  readonly apiKeyRef: string;
  readonly timeoutMs: number;
  /** Never the value: only whether the credential reference currently resolves. */
  readonly apiKeyConfigured: boolean;
  /** The active provider layer, such as `env` or the provider store. */
  readonly apiKeySource?: string;
}

export interface KnowledgeSettingsPatch {
  readonly baseUrl?: string;
  readonly defaultKbId?: string | null;
  readonly apiKeyRef?: string;
  /** Transient write-only value stored through `ctx.credentials.set`. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

export interface KnowledgePage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total?: number;
}

export interface KnowledgeServiceOptions {
  /** Default endpoint before a member saves their own connection. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly apiKeyRef?: string;
  readonly fetchImpl?: FetchLike;
}

const parseStatusLabel = (status: KnowledgeParseStatus): string => {
  switch (status) {
    case 'completed': return '已解析';
    case 'processing': return '解析中';
    case 'pending': return '待解析';
    case 'failed': return '解析失败';
    default: return '状态未知';
  }
};

const toParseStatus = (value: string | undefined): KnowledgeParseStatus => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'completed' || normalized === 'success' || normalized === 'done') return 'completed';
  if (normalized === 'processing' || normalized === 'running' || normalized === 'parsing') return 'processing';
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'waiting') return 'pending';
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  return 'unknown';
};

const clampInteger = (value: number | undefined, minimum: number, maximum: number, fallback: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isInteger(value) ? value! : fallback));

const fileNameFromDisposition = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(value);
  if (encoded?.[1]) { try { return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1]?.trim();
};

/**
 * Business service over {@link WeKnoraClient}: knowledge bases, documents,
 * chunks, preview and hybrid search. Connection settings and the credential
 * reference live in the `workdsh_knowledge` storage domain; the API key value
 * is resolved from `ctx.credentials` per operation and never persisted here.
 */
export class KnowledgeService extends Service {
  static inject = ['storageDomain', 'credentials'];
  private table?: KvTable<string, KnowledgeConnectionState>;
  private readonly options: KnowledgeServiceOptions;

  constructor(ctx: Context, options: KnowledgeServiceOptions = {}) {
    super(ctx, 'workdshKnowledge');
    this.options = options;
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(knowledgeDomainSpec);
    this.table = domain.table('connections');
    this.ctx.effect(() => () => domain.close(), 'workdshKnowledge.domainClose');
  }

  async settings(actor: ActorContext, signal?: AbortSignal): Promise<KnowledgeSettings> {
    const state = await this.ensureState(actor, signal);
    return this.settingsView(state.connection);
  }

  async updateSettings(actor: ActorContext, patch: KnowledgeSettingsPatch, signal?: AbortSignal): Promise<KnowledgeSettings> {
    signal?.throwIfAborted();
    const state = await this.ensureState(actor, signal);
    const current = state.connection;
    const defaultKbId = patch.defaultKbId === null ? undefined
      : patch.defaultKbId === undefined ? current.defaultKbId
        : this.cleanId(patch.defaultKbId, '默认知识库 ID');
    const next: KnowledgeConnection = {
      baseUrl: patch.baseUrl === undefined ? current.baseUrl : normalizeBaseUrl(patch.baseUrl),
      ...(defaultKbId === undefined ? {} : { defaultKbId }),
      apiKeyRef: patch.apiKeyRef === undefined ? current.apiKeyRef : this.cleanCredentialRef(patch.apiKeyRef),
      timeoutMs: clampInteger(patch.timeoutMs, 1_000, 120_000, current.timeoutMs),
    };
    if (patch.apiKey !== undefined) {
      const value = patch.apiKey.trim();
      if (value) await this.ctx.credentials.set(credentialRef(next.apiKeyRef), value);
    }
    signal?.throwIfAborted();
    await this.states().put(this.key(actor), { ...state, connection: next, updatedAt: new Date().toISOString() });
    return this.settingsView(next);
  }

  async listKbs(actor: ActorContext, signal?: AbortSignal): Promise<readonly KnowledgeBase[]> {
    const client = await this.clientFor(actor, signal);
    const page = await client.getPage<unknown>(`${API}/knowledge-bases`, { page: 1, page_size: MAX_PAGE_SIZE }, signal, { page: 1, pageSize: MAX_PAGE_SIZE });
    return page.items.map(raw => this.mapKb(raw));
  }

  async getKb(actor: ActorContext, kbId: string, signal?: AbortSignal): Promise<KnowledgeBase> {
    const client = await this.clientFor(actor, signal);
    return this.mapKb(await client.getJson<unknown>(`${API}/knowledge-bases/${encodeURIComponent(this.cleanId(kbId, '知识库 ID'))}`, undefined, signal));
  }

  async listDocuments(actor: ActorContext, kbId: string, options: { readonly page?: number; readonly pageSize?: number } = {}, signal?: AbortSignal): Promise<KnowledgePage<KnowledgeDocument>> {
    const page = clampInteger(options.page, 1, 100_000, 1);
    const pageSize = clampInteger(options.pageSize, 1, MAX_PAGE_SIZE, 20);
    const client = await this.clientFor(actor, signal);
    const result = await client.getPage<unknown>(
      `${API}/knowledge-bases/${encodeURIComponent(this.cleanId(kbId, '知识库 ID'))}/knowledge`,
      { page, page_size: pageSize },
      signal,
      { page, pageSize },
    );
    return { items: result.items.map(raw => this.mapDocument(raw)), page: result.page, pageSize: result.pageSize, ...(result.total === undefined ? {} : { total: result.total }) };
  }

  async getDocument(actor: ActorContext, knowledgeId: string, signal?: AbortSignal): Promise<KnowledgeDocument> {
    const client = await this.clientFor(actor, signal);
    return this.mapDocument(await client.getJson<unknown>(`${API}/knowledge/${encodeURIComponent(this.cleanId(knowledgeId, '文档 ID'))}`, undefined, signal));
  }

  /**
   * File preview. The endpoint returns the original bytes inline, so this keeps
   * only a bounded prefix (via HTTP Range) and derives a text preview: the file
   * head when it is textual, otherwise the first parsed chunks.
   */
  async getDocumentPreview(actor: ActorContext, knowledgeId: string, signal?: AbortSignal): Promise<KnowledgePreview> {
    const id = this.cleanId(knowledgeId, '文档 ID');
    const client = await this.clientFor(actor, signal);
    const raw = await client.getRaw(`${API}/knowledge/${encodeURIComponent(id)}/preview`, { signal, range: 'bytes=0-4095', maxBytes: 8 * 1024 });
    const contentType = raw.contentType ?? '';
    const textual = /^(?:text\/|application\/(?:json|xml|x-ndjson|ld\+json|javascript))/i.test(contentType);
    let text = textual && raw.bytes.byteLength ? new TextDecoder('utf-8', { fatal: false }).decode(raw.bytes) : '';
    let source: 'original' | 'parsed' = 'original';
    let truncated = raw.status === 206 || (raw.contentLength !== undefined && raw.contentLength > raw.bytes.byteLength);
    if (!text.trim()) {
      const chunks = await this.listChunks(actor, id, { page: 1, pageSize: 5 }, signal);
      text = chunks.items.slice(0, 3).map(chunk => chunk.content).join('\n\n');
      source = 'parsed';
      truncated = (chunks.total ?? chunks.items.length) > Math.min(3, chunks.items.length);
    }
    const fileName = fileNameFromDisposition(raw.contentDisposition);
    return {
      knowledgeId: id,
      ...(fileName ? { fileName } : {}),
      ...(contentType ? { contentType } : {}),
      ...(raw.contentLength === undefined ? {} : { byteLength: raw.contentLength }),
      text,
      source,
      truncated,
    };
  }

  async listChunks(actor: ActorContext, knowledgeId: string, options: { readonly page?: number; readonly pageSize?: number } = {}, signal?: AbortSignal): Promise<KnowledgePage<KnowledgeChunk>> {
    const page = clampInteger(options.page, 1, 100_000, 1);
    const pageSize = clampInteger(options.pageSize, 1, MAX_PAGE_SIZE, 20);
    const client = await this.clientFor(actor, signal);
    const result = await client.getPage<unknown>(
      `${API}/chunks/${encodeURIComponent(this.cleanId(knowledgeId, '文档 ID'))}`,
      { page, page_size: pageSize },
      signal,
      { page, pageSize },
    );
    return { items: result.items.map(raw => this.mapChunk(raw)), page: result.page, pageSize: result.pageSize, ...(result.total === undefined ? {} : { total: result.total }) };
  }

  async hybridSearch(actor: ActorContext, kbId: string, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<readonly KnowledgeSearchHit[]> {
    const query = this.cleanQuery(input.query);
    const matchCount = clampInteger(input.matchCount, 1, MAX_MATCH_COUNT, 5);
    const mode: KnowledgeSearchMode = input.mode ?? 'hybrid';
    const client = await this.clientFor(actor, signal);
    const result = await client.postPage<unknown>(
      `${API}/knowledge-bases/${encodeURIComponent(this.cleanId(kbId, '知识库 ID'))}/hybrid-search`,
      {
        query_text: query,
        match_count: matchCount,
        ...(mode === 'semantic' ? { disable_keywords_match: true } : {}),
        ...(mode === 'keyword' ? { disable_vector_match: true } : {}),
      },
      signal,
    );
    return result.items.map(raw => this.mapHit(raw));
  }

  /**
   * Search with a knowledge-base fallback chain: explicit `kbId`, then the
   * member's default KB, then the only KB the tenant exposes.
   */
  async search(actor: ActorContext, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<readonly KnowledgeSearchHit[]> {
    let kbId = input.kbId?.trim();
    if (!kbId) kbId = (await this.ensureState(actor, signal)).connection.defaultKbId;
    if (!kbId) {
      const kbs = await this.listKbs(actor, signal);
      if (kbs.length === 1) kbId = kbs[0]!.id;
    }
    if (!kbId) throw new KnowledgeError('knowledge/invalid-request', '请指定知识库（kb_id），或在知识库设置中配置默认知识库。');
    return this.hybridSearch(actor, kbId, input, signal);
  }

  /** Read one document as text with stable character offsets, built from its chunks. */
  async readDocument(actor: ActorContext, knowledgeId: string, options: { readonly offset?: number; readonly limit?: number } = {}, signal?: AbortSignal): Promise<KnowledgeReadResult> {
    const offset = clampInteger(options.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const limit = clampInteger(options.limit, 1, MAX_READ_LIMIT, 8_000);
    const document = await this.getDocument(actor, knowledgeId, signal);
    const pieces: string[] = [];
    let length = 0;
    let page = 1;
    let exhausted = false;
    while (length < offset + limit && page <= MAX_READ_PAGES) {
      const chunks = await this.listChunks(actor, knowledgeId, { page, pageSize: MAX_PAGE_SIZE }, signal);
      for (const chunk of chunks.items) {
        pieces.push(chunk.content);
        length += chunk.content.length + 2;
        if (length >= offset + limit) break;
      }
      const total = chunks.total ?? chunks.items.length * page;
      if (!chunks.items.length || page * chunks.pageSize >= total) { exhausted = true; break; }
      page += 1;
    }
    const complete = pieces.join('\n\n');
    const content = complete.slice(offset, offset + limit);
    const nextOffset = offset + content.length;
    const truncated = nextOffset < complete.length || !exhausted;
    return {
      knowledgeId: document.id,
      ...(document.knowledgeBaseId ? { knowledgeBaseId: document.knowledgeBaseId } : {}),
      title: document.title,
      content,
      offset,
      ...(truncated ? { nextOffset } : {}),
      truncated,
    };
  }

  private async clientFor(actor: ActorContext, signal?: AbortSignal): Promise<WeKnoraClient> {
    const state = await this.ensureState(actor, signal);
    const resolved = await this.ctx.credentials.resolve(credentialRef(state.connection.apiKeyRef));
    if (!resolved?.value) {
      throw new KnowledgeError('knowledge/credential-missing', `知识库 API Key 未配置：凭据引用 ${state.connection.apiKeyRef} 尚无值。请在插件设置中保存 API Key，或设置同名环境变量。`);
    }
    return new WeKnoraClient({
      baseUrl: state.connection.baseUrl,
      apiKey: resolved.value,
      timeoutMs: state.connection.timeoutMs,
      ...(this.options.retries === undefined ? {} : { retries: this.options.retries }),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
  }

  private async settingsView(connection: KnowledgeConnection): Promise<KnowledgeSettings> {
    const info = await this.ctx.credentials.describe(credentialRef(connection.apiKeyRef));
    return {
      ...connection,
      apiKeyConfigured: info.configured,
      ...(info.source ? { apiKeySource: info.source } : {}),
    };
  }

  private async ensureState(actor: ActorContext, signal?: AbortSignal): Promise<KnowledgeConnectionState> {
    signal?.throwIfAborted();
    this.validateActor(actor);
    const key = this.key(actor);
    const current = this.states().get(key);
    if (current) {
      if (current.owner.organizationId !== actor.organizationId || current.owner.principalId !== actor.principalId) throw new KnowledgeError('knowledge/invalid-request', '知识库连接配置归属不一致，无法执行操作。');
      return current;
    }
    const state: KnowledgeConnectionState = {
      schemaVersion: 1,
      owner: { organizationId: actor.organizationId, principalId: actor.principalId },
      connection: this.defaultConnection(),
      updatedAt: new Date().toISOString(),
    };
    await this.states().put(key, state);
    return state;
  }

  private defaultConnection(): KnowledgeConnection {
    const baseUrl = this.options.baseUrl ?? process.env.WEKNORA_BASE_URL ?? DEFAULT_BASE_URL;
    const apiKeyRef = this.options.apiKeyRef ?? process.env.WEKNORA_API_KEY_REF ?? DEFAULT_API_KEY_REF;
    const timeoutMs = clampInteger(this.options.timeoutMs, 1_000, 120_000, DEFAULT_TIMEOUT_MS);
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKeyRef: this.cleanCredentialRef(apiKeyRef),
      timeoutMs,
    };
  }

  private mapKb(raw: unknown): KnowledgeBase {
    const record = jsonRecord(raw) ?? {};
    const id = asString(record.id) ?? asString(record.knowledge_base_id);
    if (!id) throw new KnowledgeError('knowledge/malformed', '知识库列表缺少标识。');
    return {
      id,
      name: asString(record.name) ?? '未命名知识库',
      description: asString(record.description) ?? '',
      knowledgeCount: asNumber(record.knowledge_count) ?? 0,
      ...(asString(record.type) ? { type: asString(record.type)! } : {}),
      ...(asString(record.updated_at) ? { updatedAt: asString(record.updated_at)! } : {}),
    };
  }

  private mapDocument(raw: unknown): KnowledgeDocument {
    const record = jsonRecord(raw) ?? {};
    const id = asString(record.id);
    if (!id) throw new KnowledgeError('knowledge/malformed', '文档数据缺少标识。');
    const parseStatus = toParseStatus(asString(record.parse_status));
    const errorMessage = asString(record.error_message);
    return {
      id,
      knowledgeBaseId: asString(record.knowledge_base_id) ?? '',
      ...(asString(record.knowledge_base_name) ? { knowledgeBaseName: asString(record.knowledge_base_name)! } : {}),
      title: asString(record.title) ?? asString(record.file_name) ?? id,
      ...(asString(record.file_name) ? { fileName: asString(record.file_name)! } : {}),
      ...(asString(record.file_type) ? { fileType: asString(record.file_type)! } : {}),
      parseStatus,
      parseStatusLabel: parseStatusLabel(parseStatus),
      ...(errorMessage && errorMessage.trim() ? { errorMessage: errorMessage.trim() } : {}),
      ...(asString(record.description) ? { description: asString(record.description)! } : {}),
      ...(asNumber(record.file_size) === undefined ? {} : { sizeBytes: asNumber(record.file_size)! }),
      ...(asString(record.created_at) ? { createdAt: asString(record.created_at)! } : {}),
      ...(asString(record.updated_at) ? { updatedAt: asString(record.updated_at)! } : {}),
    };
  }

  private mapChunk(raw: unknown): KnowledgeChunk {
    const record = jsonRecord(raw) ?? {};
    const id = asString(record.id) ?? asString(record.chunk_id);
    const content = asString(record.content) ?? '';
    if (!id) throw new KnowledgeError('knowledge/malformed', '分块数据缺少标识。');
    return {
      id,
      knowledgeId: asString(record.knowledge_id) ?? '',
      chunkIndex: asNumber(record.chunk_index) ?? 0,
      content,
      ...(asNumber(record.start_at) === undefined ? {} : { startAt: asNumber(record.start_at)! }),
      ...(asNumber(record.end_at) === undefined ? {} : { endAt: asNumber(record.end_at)! }),
    };
  }

  private mapHit(raw: unknown): KnowledgeSearchHit {
    const record = jsonRecord(raw) ?? {};
    const content = asString(record.content) ?? '';
    const knowledgeId = asString(record.knowledge_id) ?? '';
    const chunkId = asString(record.id) ?? asString(record.chunk_id) ?? '';
    if (!knowledgeId && !chunkId) throw new KnowledgeError('knowledge/malformed', '检索结果缺少出处标识。');
    return {
      chunkId,
      knowledgeId,
      knowledgeTitle: asString(record.knowledge_title) ?? asString(record.title) ?? '未命名文档',
      knowledgeBaseId: asString(record.knowledge_base_id) ?? '',
      score: asNumber(record.score) ?? 0,
      content,
      ...(asNumber(record.chunk_index) === undefined ? {} : { chunkIndex: asNumber(record.chunk_index)! }),
    };
  }

  private cleanId(value: string, label: string): string {
    const id = value?.trim();
    if (!id || id.length > 512 || /[\u0000-\u001f]/.test(id)) throw new KnowledgeError('knowledge/invalid-request', `${label}无效。`);
    return id;
  }

  private cleanQuery(value: string): string {
    const query = value?.trim();
    if (!query) throw new KnowledgeError('knowledge/invalid-request', '检索关键词不能为空。');
    if (query.length > 2_000) throw new KnowledgeError('knowledge/invalid-request', '检索关键词过长。');
    return query;
  }

  private cleanCredentialRef(value: string): string {
    const ref = value?.trim();
    if (!ref || !CREDENTIAL_REF.test(ref)) throw new KnowledgeError('knowledge/invalid-config', '凭据引用必须是环境变量名形式的标识符（字母、数字、下划线）。');
    return ref;
  }

  private key(actor: ActorContext): string { return knowledgeStateKey(actor.organizationId, actor.principalId); }
  private validateActor(actor: ActorContext): void {
    if (!actor.organizationId?.trim() || !actor.principalId?.trim() || !actor.requestId?.trim() || !actor.resolvedBy?.trim()) {
      throw new KnowledgeError('knowledge/invalid-request', '知识库操作缺少可信身份上下文。');
    }
  }
  private states(): KvTable<string, KnowledgeConnectionState> {
    if (!this.table) throw new KnowledgeError('knowledge/unavailable', '知识库存储尚未就绪。');
    return this.table;
  }
}

