import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentQuery,
  KnowledgePage,
  KnowledgePreview,
  KnowledgeSearchHit,
  KnowledgeSearchMode,
  KnowledgeSelectionInput,
  KnowledgeSettings,
  KnowledgeSettingsPatch,
  KnowledgeWikiPage,
} from '../services/knowledge-service.js';
import type { KnowledgeSelectionEntry } from '../storage/domain.js';

const path = '/api/epuberdsh-knowledge';

const invoke = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const result = await response.json() as { ok?: boolean; value?: T; error?: { message?: string } };
  if (!result.ok) throw new Error(result.error?.message ?? '知识库操作失败。');
  return result.value as T;
};

export interface KnowledgeSearchRequest {
  readonly query: string;
  readonly kbId?: string;
  readonly knowledgeBaseIds?: readonly string[];
  readonly knowledgeIds?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly limit?: number;
  readonly matchCount?: number;
  readonly mode?: KnowledgeSearchMode;
}

/** One base's ability to answer a search, as reported by the service itself. */
export interface KnowledgeSearchScope {
  readonly id: string;
  readonly name: string;
  readonly chunkCount: number;
  readonly searchable: boolean;
  /** Channels that can answer: `inline` (vector/keyword index) and/or `wiki`. */
  readonly channels: readonly ('inline' | 'wiki')[];
  readonly reason?: string;
}

/** Browser-side typed wrapper over the host's knowledge transport endpoints. */
export function createKnowledgeClient(lifetime?: AbortSignal) {
  const withLifetime = (signal?: AbortSignal): AbortSignal | undefined =>
    signal && lifetime ? AbortSignal.any([signal, lifetime]) : signal ?? lifetime;
  return {
    settings: (signal?: AbortSignal) => invoke<KnowledgeSettings>('settings', {}, withLifetime(signal)),
    updateSettings: (patch: KnowledgeSettingsPatch, signal?: AbortSignal) => invoke<KnowledgeSettings>('update-settings', patch, withLifetime(signal)),
    listKbs: (signal?: AbortSignal) => invoke<readonly KnowledgeBase[]>('list-kbs', {}, withLifetime(signal)),
    getKb: (kbId: string, signal?: AbortSignal) => invoke<KnowledgeBase>('get-kb', { kbId }, withLifetime(signal)),
    listDocuments: (kbId: string, query: KnowledgeDocumentQuery = {}, signal?: AbortSignal) =>
      invoke<KnowledgePage<KnowledgeDocument>>('list-documents', { kbId, ...query }, withLifetime(signal)),
    getDocument: (knowledgeId: string, signal?: AbortSignal) => invoke<KnowledgeDocument>('get-document', { knowledgeId }, withLifetime(signal)),
    getPreview: (knowledgeId: string, signal?: AbortSignal) => invoke<KnowledgePreview>('get-preview', { knowledgeId }, withLifetime(signal)),
    listChunks: (knowledgeId: string, query: KnowledgeDocumentQuery = {}, signal?: AbortSignal) =>
      invoke<KnowledgePage<KnowledgeChunk>>('list-chunks', { knowledgeId, ...query }, withLifetime(signal)),
    search: (request: KnowledgeSearchRequest, signal?: AbortSignal) => invoke<readonly KnowledgeSearchHit[]>('search', {
      query: request.query,
      ...(request.knowledgeBaseIds?.length ? { knowledge_base_ids: [...request.knowledgeBaseIds] } : {}),
      ...(request.kbId ? { kbId: request.kbId } : {}),
      ...(request.knowledgeIds?.length ? { knowledge_ids: [...request.knowledgeIds] } : {}),
      ...(request.tagIds?.length ? { tag_ids: [...request.tagIds] } : {}),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(request.matchCount === undefined ? {} : { matchCount: request.matchCount }),
      ...(request.mode ? { mode: request.mode } : {}),
    }, withLifetime(signal)),
    /** Read one wiki page in full; hits of `via: 'wiki'` locate pages this reads. */
    readWiki: (kbId: string, slug: string, signal?: AbortSignal) =>
      invoke<KnowledgeWikiPage>('read-wiki', { kbId, slug }, withLifetime(signal)),
    /** Why a search over these bases is or is not able to answer. */
    searchScope: (knowledgeBaseIds: readonly string[], signal?: AbortSignal) =>
      invoke<readonly KnowledgeSearchScope[]>('search-scope', { knowledge_base_ids: [...knowledgeBaseIds] }, withLifetime(signal)),
    /** Knowledge bases this conversation currently references. */
    selection: (sessionId: string, signal?: AbortSignal) =>
      invoke<readonly KnowledgeSelectionEntry[]>('selection', { sessionId }, withLifetime(signal)),
    /** Replace the conversation's knowledge-base binding; an empty list clears it. */
    setSelection: (sessionId: string, knowledgeBases: readonly KnowledgeSelectionInput[], signal?: AbortSignal) =>
      invoke<readonly KnowledgeSelectionEntry[]>('set-selection', { sessionId, knowledgeBases }, withLifetime(signal)),
  };
}

export type KnowledgeClient = ReturnType<typeof createKnowledgeClient>;
