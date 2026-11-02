import type { Context } from '@deepseek-ai/cordis';
import type { SkillInstallScope } from 'epuberdsh-contracts/skills';
import type {
  SkillHubConfigureInput, SkillHubDetail, SkillHubInstallResult, SkillHubSearchResult, SkillHubSettingsView,
} from '../skillhub-contract.js';

const path = '/api/workdsh-skills/skillhub';

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function failure(value: unknown): Error {
  if (isRecord(value) && typeof value.message === 'string') return Object.assign(new Error(value.message), { code: typeof value.code === 'string' ? value.code : 'skillhub/request-failed' });
  return new Error('技能中心操作失败，请重试。');
}

function transportFailure(cause: unknown): Error {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return Object.assign(new Error('技能中心响应超时，请稍后重试。'), { code: 'skillhub/timeout' });
  if (cause instanceof DOMException && cause.name === 'AbortError') return Object.assign(new Error('操作已取消。'), { code: 'skillhub/cancelled' });
  return cause instanceof Error ? cause : new Error('无法连接技能中心服务，请重试。');
}

async function request<T>(endpoint: string, payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }), signal: requestSignal,
    });
    const result = await response.json() as { ok?: boolean; value?: unknown; error?: unknown };
    if (!result.ok) throw failure(result.error);
    return result.value as T;
  } catch (cause) { throw transportFailure(cause); }
}

/** Thin browser face over the Host SkillHub bridge: no registry address or token reaches this layer. */
export function createSkillHubClient(ctx: Context, lifetime?: AbortSignal) {
  void ctx;
  const scoped = (signal?: AbortSignal) => lifetime && signal ? AbortSignal.any([lifetime, signal]) : lifetime ?? signal;
  const invoke = <T>(endpoint: string, payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) =>
    request<T>(endpoint, payload, timeoutMs, scoped(signal));
  return {
    status: (signal?: AbortSignal) => invoke<SkillHubSettingsView>('status', {}, 15_000, signal),
    configure: (input: SkillHubConfigureInput) => invoke<SkillHubSettingsView>('configure', { ...input }, 30_000),
    forget: () => invoke<SkillHubSettingsView>('forget', {}, 15_000),
    search: (input: { query?: string; namespace?: string; page?: number; pageSize?: number }, signal?: AbortSignal) =>
      invoke<SkillHubSearchResult>('search', { ...input }, 30_000, signal),
    detail: (input: { namespace: string; slug: string }, signal?: AbortSignal) =>
      invoke<SkillHubDetail>('detail', { ...input }, 30_000, signal),
    install: (input: { namespace: string; slug: string; version?: string; scope?: SkillInstallScope }, signal?: AbortSignal) =>
      invoke<SkillHubInstallResult>('install', { ...input }, 180_000, signal),
  };
}

export type SkillHubClient = ReturnType<typeof createSkillHubClient>;
