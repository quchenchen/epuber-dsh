import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeChunk,
  KnowledgeDeleteResult,
  KnowledgeDocument,
  KnowledgeDocumentQuery,
  KnowledgePage,
  KnowledgePreview,
  KnowledgeSearchHit,
  KnowledgeSearchMode,
  KnowledgeSettings,
  KnowledgeSettingsPatch,
} from '../services/knowledge-service.js';

/** Encode a browser File as base64 for the Host transport (which rebuilds the multipart upload). */
export async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

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
    createKb: (input: KnowledgeBaseCreateInput, signal?: AbortSignal) => invoke<KnowledgeBase>('create-kb', input, withLifetime(signal)),
    updateKb: (kbId: string, input: KnowledgeBaseUpdateInput, signal?: AbortSignal) => invoke<KnowledgeBase>('update-kb', { kbId, ...input }, withLifetime(signal)),
    deleteKb: (kbId: string, signal?: AbortSignal) => invoke<{ deleted: boolean }>('delete-kb', { kbId }, withLifetime(signal)),
    uploadDocument: (kbId: string, file: { fileName: string; base64: string; mediaType?: string }, signal?: AbortSignal) =>
      invoke<KnowledgeDocument>('upload-document', { kbId, ...file }, withLifetime(signal)),
    deleteDocument: (knowledgeId: string, signal?: AbortSignal) => invoke<KnowledgeDeleteResult>('delete-document', { knowledgeId }, withLifetime(signal)),
    reparseDocument: (knowledgeId: string, signal?: AbortSignal) => invoke<KnowledgeDocument>('reparse-document', { knowledgeId }, withLifetime(signal)),
    getDocument: (knowledgeId: string, signal?: AbortSignal) => invoke<KnowledgeDocument>('get-document', { knowledgeId }, withLifetime(signal)),
    getPreview: (knowledgeId: string, signal?: AbortSignal) => invoke<KnowledgePreview>('get-preview', { knowledgeId }, withLifetime(signal)),
    listChunks: (knowledgeId: string, query: KnowledgeDocumentQuery = {}, signal?: AbortSignal) =>
      invoke<KnowledgePage<KnowledgeChunk>>('list-chunks', { knowledgeId, ...query }, withLifetime(signal)),
    search: (request: KnowledgeSearchRequest, signal?: AbortSignal) =>
      invoke<readonly KnowledgeSearchHit[]>('search', request, withLifetime(signal)),
  };
}

export type KnowledgeClient = ReturnType<typeof createKnowledgeClient>;
