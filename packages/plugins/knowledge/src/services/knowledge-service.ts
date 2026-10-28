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
  readData,
  type FetchLike,
  type Page,
} from './weknora-client.js';
import {
  DEFAULT_API_KEY_REF,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  knowledgeDomainSpec,
  knowledgeSelectionKey,
  knowledgeStateKey,
  type KnowledgeConnection,
  type KnowledgeConnectionState,
  type KnowledgeSelectionEntry,
  type KnowledgeSelectionState,
} from '../storage/domain.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshKnowledge: KnowledgeService; } }

const API = '/api/v1';
const MAX_PAGE_SIZE = 100;
const MAX_MATCH_COUNT = 20;
const MAX_READ_LIMIT = 20_000;
const MAX_READ_PAGES = 10;
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** WeKnora rejects uploads above MAX_FILE_SIZE_MB (50MB by default). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_KB_NAME_LENGTH = 128;
const MAX_KB_DESCRIPTION_LENGTH = 4_000;
const MAX_FILE_NAME_LENGTH = 256;
/** Upper bound of knowledge bases one conversation may reference; each adds a prompt block. */
export const MAX_SESSION_KNOWLEDGE_BASES = 8;

const mediaTypesByExtension: Readonly<Record<string, string>> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', html: 'text/html', htm: 'text/html', json: 'application/json',
};

const sleepWithSignal = (milliseconds: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new KnowledgeError('knowledge/aborted', '知识库请求已取消。')); return; }
  const abort = () => { clearTimeout(timer); reject(new KnowledgeError('knowledge/aborted', '知识库请求已取消。')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
  signal?.addEventListener('abort', abort, { once: true });
});

/** How a document's parse pipeline currently stands. */
export type KnowledgeParseStatus = 'completed' | 'processing' | 'pending' | 'failed' | 'deleting' | 'unknown';
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

/** One knowledge base a conversation asks to reference; `name` is a display cache. */
export interface KnowledgeSelectionInput {
  readonly id: string;
  readonly name?: string;
  readonly documentCount?: number;
}

/**
 * Normalise one conversation's knowledge-base binding: trim and validate ids,
 * keep first occurrence of each base, enforce the per-conversation cap, and
 * fall back to a resolved or raw name so a display label never fails a write.
 */
export function normalizeKnowledgeSelection(
  entries: readonly KnowledgeSelectionInput[],
  resolvedNames: ReadonlyMap<string, string> = new Map(),
): KnowledgeSelectionEntry[] {
  const deduped = new Map<string, KnowledgeSelectionInput>();
  for (const entry of entries) {
    const id = entry?.id?.trim();
    if (!id || id.length > 512 || /[\u0000-\u001f]/.test(id)) {
      throw new KnowledgeError('knowledge/invalid-request', '知识库 ID 无效。');
    }
    if (!deduped.has(id)) deduped.set(id, { ...entry, id });
  }
  if (deduped.size > MAX_SESSION_KNOWLEDGE_BASES) {
    throw new KnowledgeError('knowledge/invalid-request', `一个对话最多引用 ${MAX_SESSION_KNOWLEDGE_BASES} 个知识库。`);
  }
  return [...deduped.values()].map(entry => {
    const name = entry.name?.trim() || resolvedNames.get(entry.id) || entry.id;
    return {
      id: entry.id,
      name: name.length > 512 ? name.slice(0, 512) : name,
      ...(entry.documentCount === undefined ? {} : { documentCount: entry.documentCount }),
    };
  });
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

export interface KnowledgeDocumentQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly parseStatus?: KnowledgeParseStatus;
}

export interface KnowledgeBaseCreateInput {
  readonly name: string;
  readonly description?: string;
  /** Existing KB whose embedding model and chunking config seed the new KB. */
  readonly templateKbId?: string;
  /** Explicit embedding model id; overrides the template's model. */
  readonly embeddingModelId?: string;
}

export interface KnowledgeBaseUpdateInput {
  readonly name?: string;
  readonly description?: string;
}

export interface KnowledgeUploadInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
}

export interface KnowledgeDeleteResult {
  readonly queued: boolean;
  readonly taskId?: string;
}

export interface KnowledgeWaitResult {
  readonly document: KnowledgeDocument;
  readonly completed: boolean;
  readonly timedOut: boolean;
}

export interface KnowledgeWaitOptions {
  /** Total wait budget, default 120000ms. */
  readonly timeoutMs?: number;
  /** Poll interval, default 3000ms. */
  readonly intervalMs?: number;
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
    case 'deleting': return '删除中';
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
  if (normalized === 'deleting' || normalized === 'deleted') return 'deleting';
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
  private selectionTable?: KvTable<string, KnowledgeSelectionState>;
  private readonly options: KnowledgeServiceOptions;

  constructor(ctx: Context, options: KnowledgeServiceOptions = {}) {
    super(ctx, 'workdshKnowledge');
    this.options = options;
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(knowledgeDomainSpec);
    this.table = domain.table('connections');
    this.selectionTable = domain.table('selections');
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

  async listDocuments(actor: ActorContext, kbId: string, options: KnowledgeDocumentQuery = {}, signal?: AbortSignal): Promise<KnowledgePage<KnowledgeDocument>> {
    const page = clampInteger(options.page, 1, 100_000, 1);
    const pageSize = clampInteger(options.pageSize, 1, MAX_PAGE_SIZE, 20);
    const client = await this.clientFor(actor, signal);
    const result = await client.getPage<unknown>(
      `${API}/knowledge-bases/${encodeURIComponent(this.cleanId(kbId, '知识库 ID'))}/knowledge`,
      { page, page_size: pageSize, ...(options.parseStatus ? { parse_status: options.parseStatus } : {}) },
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

  /**
   * Knowledge bases one conversation currently references. The record is keyed
   * by member + Session, so a Session can never read another Session's binding,
   * and a member cannot read another member's.
   */
  async sessionSelection(actor: ActorContext, sessionId: string, signal?: AbortSignal): Promise<readonly KnowledgeSelectionEntry[]> {
    signal?.throwIfAborted();
    this.validateActor(actor);
    const id = this.cleanId(sessionId, '会话 ID');
    const state = this.selections().get(knowledgeSelectionKey(actor.organizationId, actor.principalId, id));
    if (!state) return [];
    if (state.owner.organizationId !== actor.organizationId || state.owner.principalId !== actor.principalId || state.sessionId !== id) return [];
    return state.knowledgeBases;
  }

  /**
   * Replace the conversation's knowledge-base binding; an empty list clears it.
   * Names are display-only caching: a caller-supplied name is kept, otherwise the
   * service resolves names in one list call and degrades to the id when the
   * knowledge service is unreachable — binding never fails on a naming lookup.
   */
  async setSessionSelection(
    actor: ActorContext,
    sessionId: string,
    entries: readonly KnowledgeSelectionInput[],
    signal?: AbortSignal,
  ): Promise<readonly KnowledgeSelectionEntry[]> {
    signal?.throwIfAborted();
    this.validateActor(actor);
    const id = this.cleanId(sessionId, '会话 ID');
    const key = knowledgeSelectionKey(actor.organizationId, actor.principalId, id);
    if (!entries.length) {
      await this.selections().delete(key);
      return [];
    }
    const resolvedNames = new Map<string, string>();
    if (entries.some(entry => !entry?.name?.trim())) {
      try {
        for (const kb of await this.listKbs(actor, signal)) resolvedNames.set(kb.id, kb.name);
      } catch (cause) {
        if (signal?.aborted) throw cause;
        // Display-name resolution is best-effort; the binding itself stays valid.
      }
    }
    const knowledgeBases = normalizeKnowledgeSelection(entries, resolvedNames);
    signal?.throwIfAborted();
    const state: KnowledgeSelectionState = {
      schemaVersion: 1,
      owner: { organizationId: actor.organizationId, principalId: actor.principalId },
      sessionId: id,
      knowledgeBases,
      updatedAt: new Date().toISOString(),
    };
    await this.selections().put(key, state);
    return knowledgeBases;
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

  /**
   * Create a knowledge base. WeKnora needs an embedding model to parse
   * documents at all, so the new KB inherits the embedding model and chunking
   * config from an existing template KB (explicit, configured default, or the
   * first KB). Wiki/graph pipelines and question generation are kept off so a
   * freshly uploaded document reaches `completed` promptly; both can be turned
   * on later in the WeKnora console.
   */
  async createKb(actor: ActorContext, input: KnowledgeBaseCreateInput, signal?: AbortSignal): Promise<KnowledgeBase> {
    const name = this.cleanName(input.name);
    const description = this.cleanDescription(input.description);
    const client = await this.clientFor(actor, signal);
    const template = await this.creationTemplate(actor, client, input.templateKbId, signal);
    const embeddingModelId = input.embeddingModelId?.trim() || template.embeddingModelId;
    if (!embeddingModelId) {
      throw new KnowledgeError('knowledge/invalid-request', '无法确定向量模型：服务器没有可继承配置的现有知识库。请先在 WeKnora 控制台创建并配置一个知识库，或显式提供 embeddingModelId。');
    }
    const raw = await client.postJson<unknown>(`${API}/knowledge-bases`, {
      name,
      ...(description === undefined ? {} : { description }),
      embedding_model_id: embeddingModelId,
      ...(template.chunkingConfig === undefined ? {} : { chunking_config: template.chunkingConfig }),
      indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: false, graph_enabled: false },
      question_generation_config: { enabled: false, question_count: 1 },
    }, signal);
    return this.mapKb(readData(raw));
  }

  /** Update a knowledge base name/description. The API requires `name`, so a missing name is read from the current KB. */
  async updateKb(actor: ActorContext, kbId: string, input: KnowledgeBaseUpdateInput, signal?: AbortSignal): Promise<KnowledgeBase> {
    const id = this.cleanId(kbId, '知识库 ID');
    const description = this.cleanDescription(input.description);
    const client = await this.clientFor(actor, signal);
    const name = input.name === undefined || !input.name.trim()
      ? (await this.getKb(actor, id, signal)).name
      : this.cleanName(input.name);
    const raw = await client.putJson<unknown>(`${API}/knowledge-bases/${encodeURIComponent(id)}`, {
      name,
      ...(description === undefined ? {} : { description }),
    }, signal);
    return this.mapKb(readData(raw));
  }

  /** Delete a knowledge base. A missing KB is treated as already deleted (idempotent cleanup). */
  async deleteKb(actor: ActorContext, kbId: string, signal?: AbortSignal): Promise<void> {
    const id = this.cleanId(kbId, '知识库 ID');
    const client = await this.clientFor(actor, signal);
    try {
      await client.deleteJson<unknown>(`${API}/knowledge-bases/${encodeURIComponent(id)}`, signal);
    } catch (cause) {
      if (cause instanceof KnowledgeError && cause.code === 'knowledge/not-found') return;
      throw cause;
    }
  }

  /** Upload one file (multipart, field `file` plus the display `fileName`) into a KB. Parsing is asynchronous. */
  async uploadDocument(actor: ActorContext, kbId: string, input: KnowledgeUploadInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    const id = this.cleanId(kbId, '知识库 ID');
    const fileName = this.cleanFileName(input.fileName);
    if (!input.bytes.byteLength) throw new KnowledgeError('knowledge/invalid-request', '上传文件为空。');
    if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new KnowledgeError('knowledge/invalid-request', `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 上传上限。`);
    const client = await this.clientFor(actor, signal);
    const form = new FormData();
    const bytes = Uint8Array.from(input.bytes);
    const mediaType = input.mediaType?.trim() || this.mediaTypeFor(fileName);
    form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: mediaType }), fileName);
    form.append('fileName', fileName);
    const raw = await client.postMultipart<unknown>(`${API}/knowledge-bases/${encodeURIComponent(id)}/knowledge/file`, form, signal);
    return this.mapDocument(raw);
  }

  /** Delete one document. WeKnora runs deletion as an async task; use {@link waitForDocumentDeletion} to observe completion. */
  async deleteDocument(actor: ActorContext, knowledgeId: string, signal?: AbortSignal): Promise<KnowledgeDeleteResult> {
    const id = this.cleanId(knowledgeId, '文档 ID');
    const client = await this.clientFor(actor, signal);
    try {
      const raw = await client.deleteJson<unknown>(`${API}/knowledge/${encodeURIComponent(id)}`, signal);
      const data = jsonRecord(readData<unknown>(raw));
      const taskId = asString(data?.task_id);
      return { queued: true, ...(taskId ? { taskId } : {}) };
    } catch (cause) {
      if (cause instanceof KnowledgeError && cause.code === 'knowledge/not-found') return { queued: true };
      throw cause;
    }
  }

  /** Submit a reparse (rebuild chunks/index) for one document. */
  async reparseDocument(actor: ActorContext, knowledgeId: string, signal?: AbortSignal): Promise<KnowledgeDocument> {
    const id = this.cleanId(knowledgeId, '文档 ID');
    const client = await this.clientFor(actor, signal);
    const raw = await client.postJson<unknown>(`${API}/knowledge/${encodeURIComponent(id)}/reparse`, {}, signal);
    return this.mapDocument(readData(raw));
  }

  /** Poll a document until parsing settles (`completed`/`failed`) or the timeout expires. */
  async waitForDocument(actor: ActorContext, knowledgeId: string, options: KnowledgeWaitOptions = {}, signal?: AbortSignal): Promise<KnowledgeWaitResult> {
    const timeoutMs = clampInteger(options.timeoutMs, 1_000, 600_000, 120_000);
    const intervalMs = clampInteger(options.intervalMs, 500, 30_000, 3_000);
    const deadline = Date.now() + timeoutMs;
    let document = await this.getDocument(actor, knowledgeId, signal);
    while (document.parseStatus !== 'completed' && document.parseStatus !== 'failed') {
      if (Date.now() >= deadline) return { document, completed: false, timedOut: true };
      await sleepWithSignal(Math.min(intervalMs, Math.max(1, deadline - Date.now())), signal);
      document = await this.getDocument(actor, knowledgeId, signal);
    }
    return { document, completed: document.parseStatus === 'completed', timedOut: false };
  }

  /** Poll the KB document list until the document disappears (WeKnora deletes asynchronously). */
  async waitForDocumentDeletion(actor: ActorContext, kbId: string, knowledgeId: string, options: KnowledgeWaitOptions = {}, signal?: AbortSignal): Promise<boolean> {
    const timeoutMs = clampInteger(options.timeoutMs, 1_000, 600_000, 120_000);
    const intervalMs = clampInteger(options.intervalMs, 500, 30_000, 2_000);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const page = await this.listDocuments(actor, kbId, { page: 1, pageSize: MAX_PAGE_SIZE }, signal);
      if (!page.items.some(document => document.id === knowledgeId)) return true;
      if (Date.now() >= deadline) return false;
      await sleepWithSignal(Math.min(intervalMs, Math.max(1, deadline - Date.now())), signal);
    }
  }

  private async creationTemplate(actor: ActorContext, client: WeKnoraClient, templateKbId: string | undefined, signal?: AbortSignal): Promise<{ readonly embeddingModelId?: string; readonly chunkingConfig?: unknown }> {
    if (templateKbId !== undefined) this.cleanId(templateKbId, '模板知识库 ID');
    let id = templateKbId?.trim() || (await this.ensureState(actor, signal)).connection.defaultKbId;
    let raw: unknown;
    if (id) raw = await client.getJson<unknown>(`${API}/knowledge-bases/${encodeURIComponent(id)}`, undefined, signal);
    else {
      const page = await client.getPage<unknown>(`${API}/knowledge-bases`, { page: 1, page_size: 1 }, signal);
      raw = page.items[0];
      if (!raw) return {};
    }
    const record = jsonRecord(raw) ?? {};
    const embeddingModelId = asString(record.embedding_model_id)?.trim();
    const chunkingConfig = jsonRecord(record.chunking_config);
    return {
      ...(embeddingModelId ? { embeddingModelId } : {}),
      ...(chunkingConfig === undefined ? {} : { chunkingConfig }),
    };
  }

  private cleanName(value: string): string {
    const name = value?.trim();
    if (!name) throw new KnowledgeError('knowledge/invalid-request', '知识库名称不能为空。');
    if (name.length > MAX_KB_NAME_LENGTH) throw new KnowledgeError('knowledge/invalid-request', `知识库名称不能超过 ${MAX_KB_NAME_LENGTH} 个字符。`);
    if (/[\u0000-\u001f]/.test(name)) throw new KnowledgeError('knowledge/invalid-request', '知识库名称包含无效字符。');
    return name;
  }

  private cleanDescription(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const description = value.trim();
    if (description.length > MAX_KB_DESCRIPTION_LENGTH) throw new KnowledgeError('knowledge/invalid-request', `知识库描述不能超过 ${MAX_KB_DESCRIPTION_LENGTH} 个字符。`);
    return description;
  }

  private cleanFileName(value: string): string {
    const name = value?.trim();
    if (!name) throw new KnowledgeError('knowledge/invalid-request', '文件名不能为空。');
    if (name.length > MAX_FILE_NAME_LENGTH) throw new KnowledgeError('knowledge/invalid-request', `文件名不能超过 ${MAX_FILE_NAME_LENGTH} 个字符。`);
    if (/[\\/\u0000-\u001f]/.test(name)) throw new KnowledgeError('knowledge/invalid-request', '文件名不能包含路径分隔符或控制字符。');
    return name;
  }

  private mediaTypeFor(fileName: string): string {
    const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    return mediaTypesByExtension[extension] ?? 'application/octet-stream';
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
  private selections(): KvTable<string, KnowledgeSelectionState> {
    if (!this.selectionTable) throw new KnowledgeError('knowledge/unavailable', '知识库存储尚未就绪。');
    return this.selectionTable;
  }
}

