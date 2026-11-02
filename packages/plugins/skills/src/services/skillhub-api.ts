import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type { SkillHubEndpoint, SkillHubManagementService } from '../skillhub-contract.js';
import type { SkillInstallScope } from 'epuberdsh-contracts/skills';
import { publicFailure } from './connection-api.js';

/** The SkillHub connection is its own exact route: it performs outbound calls a JSON channel cannot schedule. */
export const skillHubPath = '/api/workdsh-skills/skillhub';
const maximumBodyBytes = 64 * 1024;

const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const invalidScope = Symbol('invalid-scope');

function scopeOf(value: unknown): SkillInstallScope | undefined | typeof invalidScope {
  if (value === undefined) return undefined;
  return value === 'shared-agents' || value === 'profile' ? value : invalidScope;
}

async function dispatch(service: SkillHubManagementService, rawEndpoint: unknown, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
  if (typeof rawEndpoint !== 'string') return fail('skill/invalid-request', '技能中心操作无效。');
  const endpoint = rawEndpoint as SkillHubEndpoint;
  const input = record(payload) ?? {};
  try {
    if (endpoint === 'status') return ok(await service.status());
    if (endpoint === 'forget') return ok(await service.forget());
    if (endpoint === 'configure') {
      const registryUrl = string(input.registryUrl);
      if (!registryUrl) return fail('skillhub/invalid-address', '请填写技能中心服务地址。');
      return ok(await service.configure({
        registryUrl,
        ...(string(input.namespace) ? { namespace: string(input.namespace)! } : {}),
        ...(string(input.credentialRef) ? { credentialRef: string(input.credentialRef)! } : {}),
        ...(typeof input.token === 'string' && input.token.trim() ? { token: input.token } : {}),
      }));
    }
    if (endpoint === 'search') {
      const page = typeof input.page === 'number' && Number.isFinite(input.page) ? input.page : 0;
      const pageSize = typeof input.pageSize === 'number' && Number.isFinite(input.pageSize) ? input.pageSize : 24;
      // `namespace: ''` is meaningful (every visible namespace), so test the type, not truthiness.
      const namespace = typeof input.namespace === 'string' ? input.namespace : undefined;
      return ok(await service.search({ page, pageSize, ...(namespace !== undefined ? { namespace } : {}), ...(string(input.query) ? { query: string(input.query)! } : {}) }, signal));
    }
    if (endpoint === 'detail') {
      const namespace = string(input.namespace); const slug = string(input.slug);
      if (!namespace || !slug) return fail('skill/invalid-request', '缺少技能标识。');
      return ok(await service.detail({ namespace, slug }, signal));
    }
    if (endpoint === 'install') {
      const namespace = string(input.namespace); const slug = string(input.slug);
      const scope = scopeOf(input.scope);
      if (!namespace || !slug) return fail('skill/invalid-request', '缺少技能标识。');
      if (scope === invalidScope) return fail('skill/invalid-request', '安装范围无效。');
      return ok(await service.install({
        namespace, slug,
        ...(string(input.version) ? { version: string(input.version)! } : {}),
        ...(scope ? { scope } : {}),
      }, signal));
    }
    return fail('skill/unknown-endpoint', '未知的技能中心操作。');
  } catch (error) {
    return publicFailure(error);
  }
}

/** Register the SkillHub route inside Connection's authenticated `/api` carrier. */
export function registerSkillHubConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  // Resolve per request: a route registered before the service settles must
  // report "not ready", not throw a TypeError into the generic failure path.
  const service = (): SkillHubManagementService | undefined => ctx.workdshSkillHub;
  const lifetime = new AbortController();
  const pending = new Set<Promise<Response>>();
  const unregister: Array<() => Promise<void>> = [];
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.all(unregister.map(dispose => dispose()));
    await Promise.allSettled([...pending]);
  }, 'workdsh.skillhub.fetch');
  unregister.push(connection.fetch.register({
    path: skillHubPath,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => {
      const current = new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) });
      const operation = (async (): Promise<Response> => {
        if (lifetime.signal.aborted) return Response.json(fail('skillhub/unavailable', '技能中心已停止。'), { status: 503 });
        const declaredLength = Number(current.headers.get('content-length') ?? '0');
        if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) return Response.json(fail('skill/invalid-request', '请求过大。'), { status: 413 });
        const manager = service();
        if (!manager) return Response.json(fail('skillhub/unavailable', '技能中心连接管理尚未就绪。'), { status: 503 });
        try {
          const body = record(JSON.parse(await current.text()));
          return Response.json(await dispatch(manager, body?.endpoint, body?.payload, current.signal), { headers: { 'cache-control': 'no-store' } });
        } catch (error) {
          if (error instanceof SyntaxError) return Response.json(fail('skill/invalid-request', '请求格式无效。'), { status: 400 });
          return Response.json(publicFailure(error), { headers: { 'cache-control': 'no-store' } });
        }
      })();
      pending.add(operation);
      void operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return operation;
    },
  }));
}
