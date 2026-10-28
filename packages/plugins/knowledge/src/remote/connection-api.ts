import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type { IdentityService } from 'workdsh-contracts';
import { KnowledgeError, jsonRecord } from '../services/weknora-client.js';
import type { KnowledgeSearchMode, KnowledgeSelectionInput, KnowledgeSettingsPatch } from '../services/knowledge-service.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshIdentity: IdentityService; } }

/** Same-origin endpoint the knowledge client panel calls. */
export const knowledgeManagementPath = '/api/workdsh-knowledge';

const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });

const asString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const asInteger = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) ? value : undefined;
/** Accept only a real string array; a malformed scope must not silently search everything. */
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];

const errorMessages: Readonly<Record<string, string>> = {
  'knowledge/aborted': '知识库请求已取消。',
  'knowledge/bad-request': '知识库请求参数无效。',
  'knowledge/conflict': '知识库资源状态冲突，请刷新后重试。',
  'knowledge/credential-missing': '知识库 API Key 未配置或已失效，请在设置中保存凭据。',
  'knowledge/invalid-config': '知识库连接配置无效。',
  'knowledge/invalid-request': '知识库请求无效。',
  'knowledge/malformed': '知识库返回了无法识别的数据。',
  'knowledge/network': '无法连接知识库服务，请检查服务地址与网络。',
  'knowledge/not-found': '知识库资源不存在或当前凭据无权访问。',
  'knowledge/rate-limited': '知识库请求过于频繁，请稍后重试。',
  'knowledge/rejected': '知识库服务拒绝了这次请求。',
  'knowledge/timeout': '知识库服务响应超时。',
  'knowledge/unauthorized': '知识库凭据无效，或当前凭据缺少所需能力。',
  'knowledge/unavailable': '知识库服务尚未就绪。',
  'knowledge/upstream': '知识库服务暂时不可用。',
};

const statusFor = (code: string): number => {
  if (code === 'knowledge/unauthorized' || code === 'knowledge/credential-missing') return 401;
  if (code === 'knowledge/forbidden') return 403;
  if (code === 'knowledge/not-found') return 404;
  if (code === 'knowledge/timeout') return 504;
  if (code === 'knowledge/network' || code === 'knowledge/upstream') return 502;
  if (code === 'knowledge/aborted') return 499;
  if (code === 'knowledge/invalid-request' || code === 'knowledge/invalid-config' || code === 'knowledge/bad-request') return 400;
  if (code === 'knowledge/unavailable') return 503;
  return 500;
};

const failureResponse = (cause: unknown): Response => {
  if (cause instanceof KnowledgeError) {
    return Response.json(fail(cause.code, errorMessages[cause.code] ?? cause.message), { status: statusFor(cause.code) });
  }
  return Response.json(fail('knowledge/internal', '知识库操作失败。'), { status: 500 });
};

/**
 * Register the client-facing transport endpoints. Every branch validates its
 * payload shape before touching the service, and every failure returns the
 * normalized `{ ok: false, error }` envelope the panel understands.
 */
export function registerKnowledgeConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  const unregister = connection.fetch.register({
    path: knowledgeManagementPath,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      try {
        const body = jsonRecord(await request.json());
        if (!body) return Response.json(fail('knowledge/invalid-request', '知识库请求无效。'), { status: 400 });
        const endpoint = asString(body.endpoint);
        const payload = jsonRecord(body.payload) ?? {};
        const actor = await ctx.workdshIdentity.resolve(undefined, request.signal);
        const service = ctx.workdshKnowledge;

        if (endpoint === 'settings') return Response.json(ok(await service.settings(actor, request.signal)));

        if (endpoint === 'update-settings') {
          const patch: {
            baseUrl?: string;
            defaultKbId?: string | null;
            apiKeyRef?: string;
            apiKey?: string;
            timeoutMs?: number;
          } = {};
          if (payload.baseUrl !== undefined) {
            const value = asString(payload.baseUrl);
            if (!value?.trim()) return Response.json(fail('knowledge/invalid-config', '知识库服务地址不能为空。'), { status: 400 });
            patch.baseUrl = value;
          }
          if (payload.defaultKbId !== undefined) {
            if (payload.defaultKbId === null) patch.defaultKbId = null;
            else {
              const value = asString(payload.defaultKbId);
              if (!value) return Response.json(fail('knowledge/invalid-config', '默认知识库 ID 无效。'), { status: 400 });
              patch.defaultKbId = value;
            }
          }
          if (payload.apiKeyRef !== undefined) {
            const value = asString(payload.apiKeyRef);
            if (!value) return Response.json(fail('knowledge/invalid-config', '凭据引用无效。'), { status: 400 });
            patch.apiKeyRef = value;
          }
          if (payload.apiKey !== undefined) {
            const value = asString(payload.apiKey);
            if (value === undefined) return Response.json(fail('knowledge/invalid-config', 'API Key 无效。'), { status: 400 });
            patch.apiKey = value;
          }
          if (payload.timeoutMs !== undefined) {
            const value = asInteger(payload.timeoutMs);
            if (value === undefined) return Response.json(fail('knowledge/invalid-config', '超时时间必须是整数毫秒。'), { status: 400 });
            patch.timeoutMs = value;
          }
          return Response.json(ok(await service.updateSettings(actor, patch as KnowledgeSettingsPatch, request.signal)));
        }

        if (endpoint === 'list-kbs') return Response.json(ok(await service.listKbs(actor, request.signal)));

        if (endpoint === 'get-kb' && typeof payload.kbId === 'string') {
          return Response.json(ok(await service.getKb(actor, payload.kbId, request.signal)));
        }

        if (endpoint === 'list-documents' && typeof payload.kbId === 'string') {
          return Response.json(ok(await service.listDocuments(actor, payload.kbId, {
            ...(asInteger(payload.page) === undefined ? {} : { page: asInteger(payload.page)! }),
            ...(asInteger(payload.pageSize) === undefined ? {} : { pageSize: asInteger(payload.pageSize)! }),
          }, request.signal)));
        }

        if (endpoint === 'get-document' && typeof payload.knowledgeId === 'string') {
          return Response.json(ok(await service.getDocument(actor, payload.knowledgeId, request.signal)));
        }

        if (endpoint === 'get-preview' && typeof payload.knowledgeId === 'string') {
          return Response.json(ok(await service.getDocumentPreview(actor, payload.knowledgeId, request.signal)));
        }

        if (endpoint === 'list-chunks' && typeof payload.knowledgeId === 'string') {
          return Response.json(ok(await service.listChunks(actor, payload.knowledgeId, {
            ...(asInteger(payload.page) === undefined ? {} : { page: asInteger(payload.page)! }),
            ...(asInteger(payload.pageSize) === undefined ? {} : { pageSize: asInteger(payload.pageSize)! }),
          }, request.signal)));
        }

        if (endpoint === 'search' && typeof payload.query === 'string') {
          const mode = payload.mode;
          if (mode !== undefined && mode !== 'hybrid' && mode !== 'semantic' && mode !== 'keyword') {
            return Response.json(fail('knowledge/invalid-request', '检索模式无效。'), { status: 400 });
          }
          return Response.json(ok(await service.search(actor, {
            query: payload.query,
            ...(stringList(payload.knowledge_base_ids).length ? { kbIds: stringList(payload.knowledge_base_ids) } : {}),
            ...(typeof payload.kbId === 'string' && payload.kbId ? { kbId: payload.kbId } : {}),
            ...(stringList(payload.knowledge_ids).length ? { knowledgeIds: stringList(payload.knowledge_ids) } : {}),
            ...(stringList(payload.tag_ids).length ? { tagIds: stringList(payload.tag_ids) } : {}),
            ...(asInteger(payload.limit) === undefined && asInteger(payload.matchCount) === undefined ? {}
              : { matchCount: asInteger(payload.limit) ?? asInteger(payload.matchCount)! }),
            ...(mode === undefined ? {} : { mode: mode as KnowledgeSearchMode }),
          }, request.signal)));
        }

        if (endpoint === 'read-wiki' && typeof payload.kbId === 'string' && typeof payload.slug === 'string') {
          return Response.json(ok(await service.readWikiPage(actor, payload.kbId, payload.slug, request.signal)));
        }
        if (endpoint === 'search-scope') {
          const kbIds = stringList(payload.knowledge_base_ids);
          if (!kbIds.length) return Response.json(fail('knowledge/invalid-request', '检索范围需要至少一个知识库 ID。'), { status: 400 });
          return Response.json(ok(await service.describeSearchScope(actor, kbIds, request.signal)));
        }

        if (endpoint === 'selection' && typeof payload.sessionId === 'string') {
          return Response.json(ok(await service.sessionSelection(actor, payload.sessionId, request.signal)));
        }

        if (endpoint === 'set-selection' && typeof payload.sessionId === 'string' && Array.isArray(payload.knowledgeBases)) {
          const entries: KnowledgeSelectionInput[] = [];
          for (const raw of payload.knowledgeBases) {
            const record = jsonRecord(raw);
            const id = asString(record?.id);
            if (!id?.trim()) return Response.json(fail('knowledge/invalid-request', '会话引用缺少知识库 ID。'), { status: 400 });
            const name = asString(record?.name);
            const documentCount = asInteger(record?.documentCount);
            entries.push({
              id,
              ...(name === undefined ? {} : { name }),
              ...(documentCount === undefined ? {} : { documentCount }),
            });
          }
          return Response.json(ok(await service.setSessionSelection(actor, payload.sessionId, entries, request.signal)));
        }

        return Response.json(fail('knowledge/invalid-request', '知识库请求无效。'), { status: 400 });
      } catch (cause) {
        return failureResponse(cause);
      }
    },
  });
  ctx.effect(() => unregister, 'workdsh.knowledge.fetch');
}
