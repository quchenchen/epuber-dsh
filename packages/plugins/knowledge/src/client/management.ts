import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgePage,
  KnowledgePreview,
  KnowledgeSearchHit,
  KnowledgeSearchMode,
  KnowledgeSettings,
  KnowledgeSettingsPatch,
} from '../services/knowledge-service.js';

const path = '/api/workdsh-knowledge';

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

export interface KnowledgeDocumentQuery {
  readonly page?: number;
  readonly pageSize?: number;
}

export interface KnowledgeSearchRequest {
  readonly query: string;
  readonly kbId?: string;
  readonly matchCount?: number;
  readonly mode?: KnowledgeSearchMode;
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
    search: (request: KnowledgeSearchRequest, signal?: AbortSignal) =>
      invoke<readonly KnowledgeSearchHit[]>('search', request, withLifetime(signal)),
  };
}

export type KnowledgeClient = ReturnType<typeof createKnowledgeClient>;
