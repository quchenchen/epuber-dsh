import { Context, Service } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import type { ActorContext } from 'epuberdsh-contracts';
import {
  KnowledgeError,
  WeKnoraClient,
  asNumber,
  asString,
  jsonRecord,
  normalizeBaseUrl,
  type FetchLike,
} from './weknora-client.js';
import {
  DEFAULT_API_KEY_REF,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  knowledgeDomainSpec,
  knowledgeSelectionKey,
  knowledgeStateKey,
  type KnowledgeConnection,
  type KnowledgeConnectionRow,
  type KnowledgeConnectionState,
  type KnowledgeSelectionEntry,
  type KnowledgeSelectionState,
} from '../storage/domain.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshKnowledge: KnowledgeService; } }

const API = '/api/v1';
const MAX_PAGE_SIZE = 100;
/** WeKnora's own search tool caps chunks per call at 30. */
const MAX_MATCH_COUNT = 30;
const DEFAULT_MATCH_COUNT = 10;
const MAX_READ_LIMIT = 20_000;
const MAX_READ_PAGES = 10;
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Upper bound of knowledge bases one conversation may reference; each adds a prompt block. */
export const MAX_SESSION_KNOWLEDGE_BASES = 8;
/** WeKnora's cross-base wiki search rejects more than 32 base ids. */
const MAX_WIKI_SEARCH_BASES = 32;

/**
 * Question words a wiki term lookup must shed to match.
 *
 * The wiki matcher ranks pages by a POSIX regex over title / aliases / content,
 * so `新型电力系统是什么` finds nothing while `新型电力系统` finds the concept
 * page. Only trailing/interior function words are removed — this narrows a
 * question to its subject, it never invents a different query.
 */
const WIKI_TERM_LEAD = /^(?:请问|请|帮我|帮忙|我想知道|查一下|查查|介绍一下|说明一下|告诉我)/u;
/** Where a question's framing starts; everything before it is the subject. */
const WIKI_QUESTION_CUT = /(?:是什么样的|是什么|是啥|有哪些|有何|怎么样|怎么办|怎么|为什么|为何|如何|多少|多大|吗|呢)/u;
const WIKI_TERM_NOUN_TAIL = /(?:的)?(?:定义|含义|概念|介绍|概述|综述|原理|特点|特征|作用|意义|内容|情况)$/u;

/**
 * Flatten wiki-link markup into plain text.
 *
 * Pages are authored with `[[concept/x|显示文字]]` links, which are navigation
 * metadata: keeping them in the body makes the page unreadable for both the
 * model and the user, and invites treating a slug as content. The link graph is
 * available separately; the body should read as prose.
 */
export function wikiLinksToText(markdown: string): string {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_match: string, target: string, label?: string) => {
    if (label) return label.trim();
    return (target.split('/').pop() ?? target).trim();
  });
}

/**
 * The term a wiki search should use for a natural-language question, or
 * `undefined` when the query is already a term. Deterministic on purpose: it
 * strips question framing and stops, so the caller can retry once and report
 * honestly what it searched for.
 */
export function wikiTermOf(query: string): string | undefined {
  const cleaned = query.replace(/[。！？!?；;，,、\n\r\t]/gu, ' ').trim();
  if (!cleaned) return undefined;
  for (const raw of cleaned.split(/\s+/u)) {
    let term = raw.trim();
    // Leading filler can stack ("帮我查一下…"), so strip until it stops changing.
    for (let guard = 0; guard < 4; guard += 1) {
      const next = term.replace(WIKI_TERM_LEAD, '');
      if (next === term) break;
      term = next;
    }
    // A question word marks the end of the subject: keep what precedes it.
    const cut = WIKI_QUESTION_CUT.exec(term);
    if (cut && cut.index > 0) term = term.slice(0, cut.index);
    else if (cut) continue; // the token is pure framing, try the next one
    term = term.replace(WIKI_TERM_NOUN_TAIL, '').trim();
    if (term.length >= 2) return term === query.trim() ? undefined : term;
  }
  return undefined;
}

/** How a document's parse pipeline currently stands. */
export type KnowledgeParseStatus = 'completed' | 'processing' | 'pending' | 'failed' | 'deleting' | 'unknown';
export type KnowledgeSearchMode = 'hybrid' | 'semantic' | 'keyword';

export interface KnowledgeBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly knowledgeCount: number;
  /** Chunks actually indexed; a base with 0 chunks cannot answer any search mode. */
  readonly chunkCount?: number;
  /** Which retrieval paths the base was built with; `vector`+`keyword` both false means unsearchable. */
  readonly capabilities?: KnowledgeCapabilities;
  readonly type?: string;
  readonly updatedAt?: string;
}

export interface KnowledgeCapabilities {
  readonly vector: boolean;
  readonly keyword: boolean;
  readonly wiki: boolean;
  readonly faq: boolean;
  readonly graph: boolean;
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

/**
 * Which retrieval channel produced a hit.
 *
 * `inline` is a real chunk out of the vector/keyword index: it has a
 * `knowledge_id` + `chunk_id` and its text is source prose that can be quoted.
 * `wiki` is a derived navigation page: the matched text is a summary WeKnora
 * generated from the documents, so it locates evidence but is never itself a
 * quotable source. Both channels are searches; only one of them yields citable
 * text, and callers must keep that distinction visible.
 */
export type KnowledgeRetrievalChannel = 'inline' | 'wiki';

/** A wiki page a search matched, with the documents it was built from. */
export interface KnowledgeWikiRef {
  readonly pageId: string;
  readonly slug: string;
  readonly pageType: string;
  readonly summary: string;
  readonly aliases: readonly string[];
  /** Document ids that contributed to this page (document-level granularity). */
  readonly sourceKnowledgeIds: readonly string[];
  /** How many source chunks the page cites; 0 for synopsis pages. */
  readonly chunkRefCount: number;
}

export interface KnowledgeSearchHit {
  readonly chunkId: string;
  readonly knowledgeId: string;
  readonly knowledgeTitle: string;
  readonly knowledgeBaseId: string;
  readonly score: number;
  readonly content: string;
  readonly chunkIndex?: number;
  /** Defaults to `inline` for every pre-existing caller; `wiki` carries no ids. */
  readonly via?: KnowledgeRetrievalChannel;
  /** Present only on `wiki` hits. */
  readonly wiki?: KnowledgeWikiRef;
}

/** One wiki page read in full, including the documents behind it. */
export interface KnowledgeWikiPage extends KnowledgeWikiRef {
  readonly knowledgeBaseId: string;
  readonly title: string;
  /** Raw markdown as stored, including `[[slug|label]]` wiki links. */
  readonly content: string;
  /** The same body with wiki links flattened to their label: what to read or quote. */
  readonly text: string;
  readonly updatedAt?: string;
  readonly version?: number;
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
  /** Bases to search; when empty the default base, then the only base, is used. */
  readonly kbIds?: readonly string[];
  /** Single-base shorthand kept for callers of the per-base endpoint. */
  readonly kbId?: string;
  /** Restrict to specific documents (needs the unified search endpoint). */
  readonly knowledgeIds?: readonly string[];
  /** Restrict to tagged documents (needs the unified search endpoint). */
  readonly tagIds?: readonly string[];
  readonly matchCount?: number;
  readonly mode?: KnowledgeSearchMode;
  /** 0–1 minimum vector similarity; omitted keeps the tenant retrieval config. */
  readonly vectorThreshold?: number;
  /** 0–1 minimum keyword score; omitted keeps the tenant retrieval config. */
  readonly keywordThreshold?: number;
}

/** One base's ability to answer a search, as reported by the service itself. */
export interface KnowledgeSearchScope {
  readonly id: string;
  readonly name: string;
  readonly chunkCount: number;
  readonly capabilities?: KnowledgeCapabilities;
  /** True when at least one retrieval channel can answer: index or wiki. */
  readonly searchable: boolean;
  /** Channels this base can answer on; empty means it cannot be searched at all. */
  readonly channels: readonly KnowledgeRetrievalChannel[];
  /** Why this base cannot answer, when it cannot. */
  readonly reason?: string;
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
  /** These settings belong to the organization, so one member's write serves everyone. */
  readonly scope: 'organization';
  /** Members read them; only owner/admin may change them. */
  readonly canEdit: boolean;
  /** The role that decided {@link canEdit}. */
  readonly role?: 'owner' | 'admin' | 'member';
  /** Last writer, so a member can tell whom to ask for a change. */
  readonly updatedBy?: string;
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

/** Thresholds are 0–1 similarities; anything else is a caller bug, not a reason to fail the search. */
const clampScore = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** String list out of an unknown JSON value; non-string members are dropped, not fatal. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];

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
  static inject = ['storageDomain', 'credentials', 'workdshIdentity'];
  private table?: KvTable<string, KnowledgeConnectionRow>;
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
    return this.settingsView(actor, state);
  }

  async updateSettings(actor: ActorContext, patch: KnowledgeSettingsPatch, signal?: AbortSignal): Promise<KnowledgeSettings> {
    signal?.throwIfAborted();
    // The record is shared, so a write is a tenant-wide change: gate on the
    // member's role rather than trusting whoever reached the endpoint.
    this.requireManage(actor);
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
    const written: KnowledgeConnectionState = {
      schemaVersion: 2,
      organizationId: actor.organizationId,
      updatedBy: actor.principalId,
      connection: next,
      updatedAt: new Date().toISOString(),
    };
    await this.states().put(this.key(actor), written);
    return this.settingsView(actor, written);
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

  /**
   * Per-knowledge-base hybrid search (legacy endpoint). WeKnora's chat and agent
   * both go through `/knowledge-search` instead, which also accepts several
   * bases, tag/knowledge scoping and threshold overrides; this stays as the
   * fallback for deployments that predate that endpoint.
   */
  async hybridSearch(actor: ActorContext, kbId: string, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<readonly KnowledgeSearchHit[]> {
    const query = this.cleanQuery(input.query);
    const matchCount = clampInteger(input.matchCount, 1, MAX_MATCH_COUNT, DEFAULT_MATCH_COUNT);
    const mode: KnowledgeSearchMode = input.mode ?? 'hybrid';
    const client = await this.clientFor(actor, signal);
    const result = await client.postPage<unknown>(
      `${API}/knowledge-bases/${encodeURIComponent(this.cleanId(kbId, '知识库 ID'))}/hybrid-search`,
      {
        query_text: query,
        match_count: matchCount,
        ...this.thresholdBody(input),
        ...(mode === 'semantic' ? { disable_keywords_match: true } : {}),
        ...(mode === 'keyword' ? { disable_vector_match: true } : {}),
      },
      signal,
    );
    return result.items.map(raw => this.mapHit(raw));
  }

  /**
   * Search a base's wiki index. Wiki pages are not chunks: they are derived
   * navigation pages (concept / entity / summary) generated from the documents,
   * so a hit locates evidence instead of quoting it.
   *
   * The matcher is a term match, not a semantic one — WeKnora ranks pages with
   * a POSIX regex over title / aliases / content. A natural-language question
   * such as `新型电力系统是什么` matches nothing while the bare term matches,
   * so callers should pass terms and retry with one when a question misses.
   */
  async wikiSearch(
    actor: ActorContext, kbIds: readonly string[], query: string, limit: number, signal?: AbortSignal,
  ): Promise<readonly KnowledgeSearchHit[]> {
    const text = this.cleanQuery(query);
    const ids = kbIds.map(value => this.cleanId(value, '知识库 ID')).slice(0, MAX_WIKI_SEARCH_BASES);
    if (!ids.length) throw new KnowledgeError('knowledge/invalid-request', 'wiki 检索需要至少一个知识库。');
    const client = await this.clientFor(actor, signal);
    const result = await client.postPage<unknown>(`${API}/wiki-search`, {
      query: text,
      knowledge_base_ids: ids,
      limit: clampInteger(limit, 1, MAX_MATCH_COUNT, DEFAULT_MATCH_COUNT),
    }, signal);
    return result.items.map(raw => this.mapWikiHit(raw));
  }

  /** Read one wiki page in full, including the documents it was built from. */
  async readWikiPage(actor: ActorContext, kbId: string, slug: string, signal?: AbortSignal): Promise<KnowledgeWikiPage> {
    const id = this.cleanId(kbId, '知识库 ID');
    const path = this.cleanWikiSlug(slug);
    const client = await this.clientFor(actor, signal);
    const raw = await client.getJson<unknown>(`${API}/knowledgebase/${encodeURIComponent(id)}/wiki/pages/${path}`, undefined, signal);
    return this.mapWikiPage(raw, id);
  }


  /**
   * Resolve the bases one search targets: explicit list, then the single-base
   * field, then the member's default, then the only base the tenant exposes.
   */
  private async resolveSearchKbIds(actor: ActorContext, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<string[]> {
    const explicit = [...(input.kbIds ?? []), ...(input.kbId ? [input.kbId] : [])]
      .map(value => this.cleanId(value, '知识库 ID'))
      .filter((value, index, all) => all.indexOf(value) === index);
    if (explicit.length) return explicit;
    const preferred = (await this.ensureState(actor, signal)).connection.defaultKbId;
    if (preferred) return [this.cleanId(preferred, '默认知识库 ID')];
    const kbs = await this.listKbs(actor, signal);
    if (kbs.length === 1) return [kbs[0]!.id];
    if (!kbs.length) throw new KnowledgeError('knowledge/not-found', '知识库服务中没有可检索的知识库。');
    throw new KnowledgeError('knowledge/invalid-request', '请指定知识库（knowledge_base_ids），或在知识库设置中配置默认知识库。');
  }

  private thresholdBody(input: KnowledgeSearchInput): Record<string, number> {
    return {
      ...(input.vectorThreshold === undefined ? {} : { vector_threshold: clampScore(input.vectorThreshold) }),
      ...(input.keywordThreshold === undefined ? {} : { keyword_threshold: clampScore(input.keywordThreshold) }),
    };
  }

  /** Inline (vector/keyword) search through the unified `/knowledge-search` endpoint. */
  private async searchInline(
    actor: ActorContext, kbIds: readonly string[], input: KnowledgeSearchInput, signal?: AbortSignal,
  ): Promise<readonly KnowledgeSearchHit[]> {
    const query = this.cleanQuery(input.query);
    const matchCount = clampInteger(input.matchCount, 1, MAX_MATCH_COUNT, DEFAULT_MATCH_COUNT);
    const mode: KnowledgeSearchMode = input.mode ?? 'hybrid';
    const scoped = (input.knowledgeIds?.length ?? 0) > 0 || (input.tagIds?.length ?? 0) > 0;
    const client = await this.clientFor(actor, signal);
    const body = {
      query,
      knowledge_base_ids: kbIds,
      match_count: matchCount,
      ...this.thresholdBody(input),
      ...(scoped ? { knowledge_ids: input.knowledgeIds ?? [], tag_ids: input.tagIds ?? [] } : {}),
      ...(mode === 'semantic' ? { disable_keywords_match: true } : {}),
      ...(mode === 'keyword' ? { disable_vector_match: true } : {}),
    };
    if (!scoped) {
      try {
        const unified = await client.postPage<unknown>(`${API}/knowledge-search`, body, signal);
        return unified.items.map(raw => this.mapHit(raw));
      } catch (cause) {
        if (signal?.aborted) throw cause;
        const unsupported = cause instanceof KnowledgeError && (cause.status === 404 || cause.status === 405);
        if (!unsupported) throw cause;
        // Older deployment without the unified endpoint: search each base on its own.
      }
    }
    const merged: KnowledgeSearchHit[] = [];
    for (const kbId of kbIds) {
      merged.push(...await this.hybridSearch(actor, kbId, { ...input, kbIds: undefined, kbId }, signal));
    }
    return merged.sort((left, right) => right.score - left.score).slice(0, matchCount);
  }

  /**
   * One search over one or more bases, across both retrieval channels.
   *
   * Inline comes first because a chunk is citable prose. When it yields nothing
   * the wiki index is tried, because "no vector/keyword index" does not mean
   * "nothing here": a base can be built with wiki only and still answer, with
   * navigation-grade hits. Only when both channels miss does this spend the
   * extra metadata reads that let the caller explain why.
   */
  private async retrieve(actor: ActorContext, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<{
    readonly hits: readonly KnowledgeSearchHit[];
    readonly kbIds: readonly string[];
    readonly scope?: readonly KnowledgeSearchScope[];
    readonly wikiTerm?: string;
  }> {
    const kbIds = await this.resolveSearchKbIds(actor, input, signal);
    const matchCount = clampInteger(input.matchCount, 1, MAX_MATCH_COUNT, DEFAULT_MATCH_COUNT);
    let inlineError: unknown;
    try {
      const inline = await this.searchInline(actor, kbIds, input, signal);
      if (inline.length) return { hits: inline, kbIds };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      inlineError = cause;
    }

    const scope = await this.describeSearchScope(actor, kbIds, signal);
    const wikiKbIds = scope.filter(kb => kb.channels.includes('wiki')).map(kb => kb.id);
    if (wikiKbIds.length) {
      try {
        const hits = await this.wikiSearch(actor, wikiKbIds, input.query, matchCount, signal);
        if (hits.length) return { hits, kbIds, scope };
      } catch (cause) {
        if (signal?.aborted) throw cause;
        // A wiki miss is a data state; keep the inline error as the real cause.
        if (!inlineError) inlineError = undefined;
      }
      // Wiki matching is term-based: a full question misses where its term hits.
      const term = wikiTermOf(input.query);
      if (term) {
        try {
          const retried = await this.wikiSearch(actor, wikiKbIds, term, matchCount, signal);
          if (retried.length) return { hits: retried, kbIds, scope, wikiTerm: term };
        } catch (cause) {
          if (signal?.aborted) throw cause;
        }
      }
    }
    if (inlineError && !scope.some(kb => kb.channels.length)) throw inlineError;
    return { hits: [], kbIds, scope };
  }

  async search(actor: ActorContext, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<readonly KnowledgeSearchHit[]> {
    return (await this.retrieve(actor, input, signal)).hits;
  }

  /**
   * Search plus the reason a zero-hit result is zero and which channel answered.
   * Only an empty result pays for the extra metadata reads, and the caller can
   * then explain a data state (no index, wiki only) instead of surfacing an
   * error the user cannot act on.
   */
  async searchDetailed(actor: ActorContext, input: KnowledgeSearchInput, signal?: AbortSignal): Promise<{
    readonly hits: readonly KnowledgeSearchHit[];
    readonly scope: readonly KnowledgeSearchScope[];
    readonly wikiTerm?: string;
  }> {
    const result = await this.retrieve(actor, input, signal);
    if (result.hits.length) return { hits: result.hits, scope: [], ...(result.wikiTerm ? { wikiTerm: result.wikiTerm } : {}) };
    const scope = result.scope ?? await this.describeSearchScope(actor, result.kbIds, signal);
    return { hits: [], scope, ...(result.wikiTerm ? { wikiTerm: result.wikiTerm } : {}) };
  }

  /**
   * Why a search over these bases can or cannot return anything: which
   * retrieval channels each base was built with. Vector/keyword/index absence is
   * a data state, not a failure, and a wiki-only base is still searchable — the
   * caller must say so instead of reporting an error or claiming it cannot be
   * searched at all.
   */
  async describeSearchScope(actor: ActorContext, kbIds: readonly string[], signal?: AbortSignal): Promise<readonly KnowledgeSearchScope[]> {
    const scope: KnowledgeSearchScope[] = [];
    for (const kbId of kbIds) {
      const id = this.cleanId(kbId, '知识库 ID');
      try {
        const kb = await this.getKb(actor, id, signal);
        // Searchability comes from the index flags alone: `chunk_count` reads 0
        // on deployments that never populate the counter, including bases that
        // answer searches fine, so it is reported but never gates the verdict.
        const channels: KnowledgeRetrievalChannel[] = [];
        if (!kb.capabilities || kb.capabilities.vector || kb.capabilities.keyword) channels.push('inline');
        if (kb.capabilities?.wiki) channels.push('wiki');
        scope.push({
          id: kb.id,
          name: kb.name,
          chunkCount: kb.chunkCount ?? 0,
          ...(kb.capabilities === undefined ? {} : { capabilities: kb.capabilities }),
          searchable: channels.length > 0,
          channels,
          ...(channels.length ? {} : { reason: '该知识库既未启用向量/关键词索引，也未启用 wiki，因此没有任何可用检索通道；需要在 WeKnora 控制台重建索引或重新创建知识库。' }),
        });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        scope.push({ id, name: id, chunkCount: 0, searchable: false, channels: [], reason: `无法读取知识库元数据（${cause instanceof Error ? cause.message : String(cause)}）。` });
      }
    }
    return scope;
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

  private async settingsView(actor: ActorContext, state: KnowledgeConnectionState): Promise<KnowledgeSettings> {
    const connection = state.connection;
    const info = await this.ctx.credentials.describe(credentialRef(connection.apiKeyRef));
    const role = this.roleOf(actor);
    return {
      ...connection,
      apiKeyConfigured: info.configured,
      ...(info.source ? { apiKeySource: info.source } : {}),
      scope: 'organization',
      canEdit: role === 'owner' || role === 'admin',
      ...(role === undefined ? {} : { role }),
      ...(state.updatedBy === undefined ? {} : { updatedBy: state.updatedBy }),
    };
  }

  /** The caller's role in this organization, or undefined when identity cannot say. */
  private roleOf(actor: ActorContext): 'owner' | 'admin' | 'member' | undefined {
    try {
      return this.ctx.workdshIdentity.membership(actor.organizationId, actor.principalId)?.role;
    } catch {
      // An identity provider that is not ready must not crash a settings read;
      // the undefined role is treated as "cannot manage" by requireManage.
      return undefined;
    }
  }

  /**
   * Settings are tenant-wide, so changing them is an administrative action.
   * A member who could repoint `baseUrl` would also be handing the stored API
   * key to a server of their choosing, which is why this is not merely a UI rule.
   */
  private requireManage(actor: ActorContext): void {
    const role = this.roleOf(actor);
    if (role === 'owner' || role === 'admin') return;
    throw new KnowledgeError('knowledge/forbidden', role === 'member'
      ? '知识库连接设置由组织统一管理，只有所有者或管理员可以修改。'
      : '无法确认当前成员在组织中的角色，已拒绝修改组织级知识库设置。');
  }

  private async ensureState(actor: ActorContext, signal?: AbortSignal): Promise<KnowledgeConnectionState> {
    signal?.throwIfAborted();
    this.validateActor(actor);
    const current = this.states().get(this.key(actor));
    if (current) {
      // A version 1 row can only be reached through a legacy key, but the type
      // says both shapes are storable, so normalize before comparing owners.
      const organizationId = current.schemaVersion === 2 ? current.organizationId : current.owner.organizationId;
      if (organizationId !== actor.organizationId) throw new KnowledgeError('knowledge/invalid-request', '知识库连接配置归属不一致，无法执行操作。');
      return {
        schemaVersion: 2,
        organizationId,
        ...(current.schemaVersion === 2 && current.updatedBy !== undefined ? { updatedBy: current.updatedBy } : {}),
        connection: current.connection,
        updatedAt: current.updatedAt,
      };
    }
    // Nothing stored yet: return the composed defaults without persisting. A
    // read must not pin them, otherwise the first member to open the panel would
    // freeze whatever WEKNORA_BASE_URL happened to be at that moment and a later
    // deployment-level change would never take effect.
    return {
      schemaVersion: 2,
      organizationId: actor.organizationId,
      connection: this.defaultConnection(),
      updatedAt: new Date().toISOString(),
    };
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
    const capabilities = jsonRecord(record.capabilities);
    const flags = capabilities === undefined ? undefined : {
      vector: capabilities.vector === true,
      keyword: capabilities.keyword === true,
      wiki: capabilities.wiki === true,
      faq: capabilities.faq === true,
      graph: capabilities.graph === true,
    };
    return {
      id,
      name: asString(record.name) ?? '未命名知识库',
      description: asString(record.description) ?? '',
      knowledgeCount: asNumber(record.knowledge_count) ?? 0,
      ...(asNumber(record.chunk_count) === undefined ? {} : { chunkCount: asNumber(record.chunk_count)! }),
      ...(flags === undefined ? {} : { capabilities: flags }),
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
      // Name the channel explicitly. The prompt tells the model that `via=inline`
      // is quotable source prose and `via=wiki` is a derived page, so an absent
      // field would leave it guessing about the one thing it must not get wrong.
      via: 'inline',
      ...(asNumber(record.chunk_index) === undefined ? {} : { chunkIndex: asNumber(record.chunk_index)! }),
    };
  }

  /**
   * A wiki search hit. It carries no `knowledge_id` / `chunk_id` because a wiki
   * page is derived, not a chunk: reporting chunk ids here would let a caller
   * cite a summary page as if it were source text.
   */
  private mapWikiHit(raw: unknown): KnowledgeSearchHit {
    const record = jsonRecord(raw) ?? {};
    const slug = asString(record.slug) ?? '';
    const pageId = asString(record.id) ?? '';
    if (!slug && !pageId) throw new KnowledgeError('knowledge/malformed', 'wiki 检索结果缺少页面标识。');
    // Snippets and summaries carry the same link markup as the page body;
    // flattened here so neither the model nor the panel reads slug noise.
    const summary = wikiLinksToText(asString(record.summary) ?? '');
    const snippet = wikiLinksToText(asString(record.match_snippet) ?? '');
    return {
      chunkId: '',
      knowledgeId: '',
      knowledgeTitle: asString(record.title) ?? slug ?? pageId,
      knowledgeBaseId: asString(record.knowledge_base_id) ?? '',
      // Pages are ranked by regex match position, not by a similarity score;
      // reporting 0 keeps callers from presenting a made-up confidence.
      score: 0,
      content: snippet || summary,
      via: 'wiki',
      wiki: {
        pageId,
        slug,
        pageType: asString(record.page_type) ?? '',
        summary,
        aliases: asStringArray(record.aliases),
        sourceKnowledgeIds: asStringArray(record.source_refs),
        chunkRefCount: asStringArray(record.chunk_refs).length,
      },
    };
  }

  private mapWikiPage(raw: unknown, kbId: string): KnowledgeWikiPage {
    const record = jsonRecord(raw) ?? {};
    const page = jsonRecord(record.data) ?? record;
    const slug = asString(page.slug) ?? '';
    const title = asString(page.title) ?? slug;
    if (!slug) throw new KnowledgeError('knowledge/malformed', 'wiki 页面缺少标识。');
    const sourceRefs = asStringArray(page.source_refs);
    return {
      pageId: asString(page.id) ?? '',
      slug,
      pageType: asString(page.page_type) ?? '',
      summary: asString(page.summary) ?? '',
      aliases: asStringArray(page.aliases),
      // `source_refs` is `<knowledge_id>|<doc_title>` in the legacy ingest
      // convention and a bare id on newer rows: keep the id, expose the title
      // separately when the row carries one.
      sourceKnowledgeIds: sourceRefs.map(ref => ref.split('|')[0] ?? ref).filter(ref => ref.length > 0),
      chunkRefCount: asStringArray(page.chunk_refs).length,
      knowledgeBaseId: asString(page.knowledge_base_id) ?? kbId,
      title,
      content: asString(page.content) ?? '',
      text: wikiLinksToText(asString(page.content) ?? ''),
      ...(asString(page.updated_at) === undefined ? {} : { updatedAt: asString(page.updated_at)! }),
      ...(asNumber(page.version) === undefined ? {} : { version: asNumber(page.version)! }),
    };
  }


  private cleanId(value: string, label: string): string {
    const id = value?.trim();
    if (!id || id.length > 512 || /[\u0000-\u001f]/.test(id)) throw new KnowledgeError('knowledge/invalid-request', `${label}无效。`);
    return id;
  }

  /**
   * A wiki slug addresses a page inside a base (`concept/xxx`, `entity/yyy`).
   * The route is a catch-all, so the slashes stay literal and each segment is
   * encoded on its own — encoding the whole slug would turn `/` into `%2F` and
   * stop matching the route.
   */
  private cleanWikiSlug(value: string): string {
    const slug = value?.trim().replace(/^\/+/u, '');
    if (!slug || slug.length > 512 || /[\u0000-\u001f]/u.test(slug) || slug.split('/').some(part => part === '..' || part === '.')) {
      throw new KnowledgeError('knowledge/invalid-request', 'wiki 页面标识（slug）无效。');
    }
    return slug.split('/').map(part => encodeURIComponent(part)).join('/');
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

  private key(actor: ActorContext): string { return knowledgeStateKey(actor.organizationId); }
  private validateActor(actor: ActorContext): void {
    if (!actor.organizationId?.trim() || !actor.principalId?.trim() || !actor.requestId?.trim() || !actor.resolvedBy?.trim()) {
      throw new KnowledgeError('knowledge/invalid-request', '知识库操作缺少可信身份上下文。');
    }
  }
  private states(): KvTable<string, KnowledgeConnectionRow> {
    if (!this.table) throw new KnowledgeError('knowledge/unavailable', '知识库存储尚未就绪。');
    return this.table;
  }
  private selections(): KvTable<string, KnowledgeSelectionState> {
    if (!this.selectionTable) throw new KnowledgeError('knowledge/unavailable', '知识库存储尚未就绪。');
    return this.selectionTable;
  }
}

