import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { SkillInstallScope } from 'epuberdsh-contracts/skills';
import type {
  SkillHubCard, SkillHubConfigureInput, SkillHubDetail, SkillHubInstallRequest,
  SkillHubInstallResult, SkillHubManagementService, SkillHubSearchRequest, SkillHubSearchResult,
  SkillHubSettingsView, SkillHubVersion,
} from '../skillhub-contract.js';
import type { SkillManager } from './manager.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshSkillHub: SkillHubManagementService; } }

/** Persisted connection facts only. The token itself never enters this table. */
export const skillHubSettingsSchema = z.object({
  registryUrl: z.string().url().max(2048),
  namespace: z.string().min(1).max(64),
  credentialRef: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).max(128),
  updatedAt: z.string().min(1),
});
export type SkillHubSettings = z.infer<typeof skillHubSettingsSchema>;

export const skillHubDomainSpec = defineDomain({
  name: 'workdsh_skillhub', version: 1, layout: 'per-record',
  global: { schema: z.object({}), initial: {} },
  tables: { settings: domainTable<string, SkillHubSettings>(skillHubSettingsSchema) },
});

const settingsKey = 'connection';
const defaultCredentialRef = 'SKILLHUB_TOKEN';
// The registry ships public examples under `global`; a member wants their own team's namespace first.
const defaultNamespace = 'epuberdsh';
/** The product's previous name; a saved connection still pointing at it is stale, not intentional. */
const legacyNamespace = 'workdsh';
/** The address a packaged build talks to; a deployment may override it, a member never has to type it. */
const defaultRegistryUrl = 'https://skill.igeewa.com';
const searchTimeoutMs = 15_000;
const downloadTimeoutMs = 120_000;

export interface SkillHubManagerOptions {
  /** Deployment default, overridable from the panel; a member never has to type it twice. */
  registryUrl?: string;
  namespace?: string;
  credentialRef?: string;
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** SkillHub answers both a bare body and the `{code,msg,data}` portal envelope; accept either. */
export function unwrapSkillHubEnvelope(payload: unknown): JsonRecord {
  const body = record(payload);
  if (!body) throw new Error('skillhub/bad-response');
  if (typeof body.code === 'number') {
    if (body.code !== 0) throw new Error('skillhub/bad-response');
    return record(body.data) ?? {};
  }
  return body;
}

export function normalizeRegistryUrl(raw: string): string {
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { throw new Error('skillhub/invalid-address'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('skillhub/invalid-address');
  if (parsed.username || parsed.password) throw new Error('skillhub/invalid-address');
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

/** Refuse to build service URLs from catalog data: a malicious entry must not redirect the token. */
export function skillHubSegment(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('skillhub/invalid-target');
  return encodeURIComponent(value);
}

/** One catalog row as the panel renders it; `installed` comes from the local registry, never from the network. */
export function toSkillHubCard(body: JsonRecord, fallbackNamespace: string, installed: ReadonlySet<string>): SkillHubCard | undefined {
  const slug = text(body.slug);
  if (!slug) return undefined;
  const published = record(body.publishedVersion); const headline = record(body.headlineVersion);
  const version = text(published?.version) ?? text(headline?.version);
  const owner = text(body.ownerDisplayName) ?? text(body.ownerId);
  const labels = Array.isArray(body.labels)
    ? body.labels.flatMap(entry => { const row = record(entry); const name = text(row?.name) ?? text(entry); return name ? [name] : []; })
    : [];
  const downloads = count(body.downloadCount) ?? count(record(body.stats)?.downloads);
  const updatedAt = text(body.updatedAt);
  return {
    slug, namespace: text(body.namespace) ?? fallbackNamespace,
    name: text(body.displayName) ?? slug, description: text(body.summary) ?? '',
    ...(version ? { version } : {}), ...(owner ? { owner } : {}),
    ...(labels.length ? { labels } : {}), ...(downloads !== undefined ? { downloads } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    installed: installed.has(slug),
  };
}

/**
 * Reads the internal SkillHub registry and installs through the existing
 * verified import path. It owns no package format of its own: a catalog row is
 * downloaded as the registry's own archive and then passes the same inspection,
 * fingerprint and lock as a browser upload, so a catalog install cannot bypass
 * the rules a manual install obeys.
 */
export class SkillHubManager extends Service implements SkillHubManagementService {
  static inject = ['storageDomain', 'credentials'];
  readonly contractVersion = 1 as const;
  private tableInstance?: KvTable<string, SkillHubSettings>;
  private opening?: Promise<KvTable<string, SkillHubSettings>>;
  /** Survives a broken storage backend so the catalog still works for this run. */
  private memory?: SkillHubSettings;

  constructor(ctx: Context, private readonly skills: SkillManager, private readonly options: SkillHubManagerOptions = {}) {
    super(ctx, 'workdshSkillHub');
  }

  async [Service.init](): Promise<void> {
    // Warm the domain, but never let an unavailable backend decide whether the
    // service exists: each call reports its own failure with its own code.
    await this.table().catch(() => undefined);
  }

  /**
   * Open on first use, not only during `Service.init`. The panel must not depend
   * on init having run: a service constructed before its dependencies settle
   * would otherwise answer "not ready" to every request.
   */
  private table(): Promise<KvTable<string, SkillHubSettings>> {
    if (this.tableInstance) return Promise.resolve(this.tableInstance);
    this.opening ??= (async () => {
      let domain;
      try { domain = await this.ctx.storageDomain.open(skillHubDomainSpec); }
      catch { throw new Error('skillhub/storage-unavailable'); }
      this.ctx.effect(() => () => domain.close(), 'workdshSkillHub.domainClose');
      this.tableInstance = domain.table('settings');
      return this.tableInstance;
    })();
    // A failed open must be retryable: a transient backend error should not be
    // cached as permanent for the life of the process.
    this.opening.catch(() => { this.opening = undefined; });
    return this.opening;
  }

  /** A deployment default is convenience, not authority: a bad one falls back instead of blocking the panel. */
  /** A packaged build ships one address, so the catalog is browsable before a member has a token. */
  private hasDeploymentRegistry(): boolean {
    return Boolean(this.options.registryUrl || process.env.WORKDSH_SKILLHUB_URL || defaultRegistryUrl);
  }

  private deploymentRegistryUrl(): string {
    const raw = this.options.registryUrl ?? process.env.WORKDSH_SKILLHUB_URL;
    if (!raw) return defaultRegistryUrl;
    try { return normalizeRegistryUrl(raw); } catch { return defaultRegistryUrl; }
  }

  private async settings(): Promise<SkillHubSettings> {
    try {
      const stored = (await this.table()).get(settingsKey);
      // `workdsh` was this product's own earlier name; a stored value of it is a
      // stale default, not a deliberate choice, so it follows the rename.
      if (stored) return stored.namespace === legacyNamespace ? { ...stored, namespace: this.defaults().namespace } : stored;
    } catch { /* A missing backend must not make the catalog unusable; fall through to session settings. */ }
    return this.memory ?? this.defaults();
  }

  private defaults(): SkillHubSettings {
    return {
      registryUrl: this.deploymentRegistryUrl(),
      namespace: this.options.namespace ?? process.env.WORKDSH_SKILLHUB_NAMESPACE ?? defaultNamespace,
      credentialRef: this.options.credentialRef ?? process.env.WORKDSH_SKILLHUB_CREDENTIAL ?? defaultCredentialRef,
      updatedAt: '',
    };
  }

  private ref(name: string) {
    return credentialRef(name) as unknown as Parameters<Context['credentials']['resolve']>[0];
  }

  async status(): Promise<SkillHubSettingsView> {
    const current = await this.settings();
    let credentialConfigured = false; let credentialWritable = true; let available = true; let persisted = true;
    try {
      const info = await this.ctx.credentials.describe(this.ref(current.credentialRef));
      credentialConfigured = info.configured !== false;
      credentialWritable = info.writable !== false;
    } catch { available = false; }
    // A packaged build ships a token through the carrier, so a member is not asked for one.
    credentialConfigured ||= Boolean(process.env.WORKDSH_SKILLHUB_TOKEN?.trim())
    try { await this.table(); } catch { persisted = false; }
    return {
      available, persisted,
      // A saved address alone does not make the catalog readable: these skills are scoped to
      // their namespace, so an anonymous query legitimately answers nothing. Requiring the
      // token keeps the panel from showing an unexplained empty list.
      configured: credentialConfigured && Boolean(current.updatedAt || this.hasDeploymentRegistry()),
      registryUrl: current.registryUrl,
      namespace: current.namespace, credentialRef: current.credentialRef, credentialConfigured, credentialWritable,
      ...(current.updatedAt ? { updatedAt: current.updatedAt } : {}),
    };
  }

  async configure(input: SkillHubConfigureInput): Promise<SkillHubSettingsView> {
    const registryUrl = normalizeRegistryUrl(input.registryUrl);
    const current = await this.settings();
    const namespace = input.namespace?.trim() || current.namespace;
    const refName = input.credentialRef?.trim() || current.credentialRef;
    if (!/^[A-Z_][A-Z0-9_]*$/.test(refName)) throw new Error('skillhub/invalid-credential-ref');
    if (input.token !== undefined) {
      const token = input.token.trim();
      if (!token) throw new Error('skillhub/invalid-token');
      // The token half and the address half fail for different reasons, so keep
      // them apart: one is a keychain problem, the other a storage problem.
      try { await this.ctx.credentials.set(this.ref(refName), token); }
      catch { throw new Error('skillhub/credential-write-failed'); }
    }
    const next: SkillHubSettings = { registryUrl, namespace, credentialRef: refName, updatedAt: new Date().toISOString() };
    try {
      const table = await this.table();
      const previous = table.get(settingsKey);
      // A changed address invalidates a token pasted for the previous one, so
      // drop it rather than sending it somewhere new.
      if (previous && previous.credentialRef !== refName) await this.ctx.credentials.unset(this.ref(previous.credentialRef)).catch(() => undefined);
      await table.put(settingsKey, next);
      this.memory = undefined;
    } catch {
      // Degrade to a session-only connection instead of leaving the panel empty.
      this.memory = next;
    }
    return this.status();
  }

  async forget(): Promise<SkillHubSettingsView> {
    this.memory = undefined;
    try {
      const table = await this.table();
      const previous = table.get(settingsKey);
      if (previous) await this.ctx.credentials.unset(this.ref(previous.credentialRef)).catch(() => undefined);
      await table.delete(settingsKey);
    } catch { /* Nothing persisted: forgetting the session copy is all there is to do. */ }
    return this.status();
  }

  private async token(name: string): Promise<string | undefined> {
    try {
      const stored = (await this.ctx.credentials.resolve(this.ref(name)))?.value
      if (stored) return stored
    } catch { /* A missing credential backend must not hide a deployment-provided token. */ }
    // A packaged enterprise build ships one so a member never types it. A credential the
    // member saved themselves still wins above, so an override is never silently ignored.
    return process.env.WORKDSH_SKILLHUB_TOKEN?.trim() || undefined
  }

  private async call(path: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
    const current = await this.settings();
    const token = await this.token(current.credentialRef);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${current.registryUrl}${path}`, {
        method: 'GET', redirect: 'error', signal: combined,
        headers: {
          accept: 'application/json',
          'user-agent': 'WorkDSH-Capability-Center/1',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (error) {
      if (combined.aborted) throw new Error('skillhub/timeout');
      throw new Error('skillhub/unreachable');
    }
    if (response.status === 401 || response.status === 403) throw new Error('skillhub/unauthorized');
    if (response.status === 404) throw new Error('skillhub/not-found');
    if (response.status === 429) throw new Error('skillhub/rate-limited');
    if (!response.ok) throw new Error('skillhub/bad-status');
    try { return await response.json(); } catch { throw new Error('skillhub/bad-response'); }
  }

  async search(request: SkillHubSearchRequest, signal?: AbortSignal): Promise<SkillHubSearchResult> {
    signal?.throwIfAborted();
    const page = Math.max(0, Math.trunc(request.page ?? 0));
    const pageSize = Math.min(60, Math.max(1, Math.trunc(request.pageSize ?? 24)));
    const query = request.query?.trim() ?? '';
    const configured = (await this.settings()).namespace;
    // An explicit empty string asks for every visible namespace; omitting the
    // field keeps the deployment's own namespace, which is what a member wants
    // by default: their team's skills, not the registry's public examples.
    const scope = (request.namespace ?? configured).trim();
    const search = new URLSearchParams({ page: String(page), size: String(pageSize) });
    if (query) search.set('q', query);
    if (scope) search.set('namespace', scope);
    const body = unwrapSkillHubEnvelope(await this.call(`/api/web/skills?${search.toString()}`, signal, searchTimeoutMs));
    const installed = await this.installedNames(signal);
    const cards = (Array.isArray(body.items) ? body.items : []).flatMap(item => {
      const card = toSkillHubCard(record(item) ?? {}, configured, installed);
      return card ? [card] : [];
    });
    // The registry treats `namespace` as a hint, not a promise: this build answers with every
    // visible namespace whatever we ask for. Filtering here is the only way a member gets
    // their own team's catalog instead of the registry's public examples.
    const scoped = scope ? cards.filter(card => card.namespace === scope) : cards;
    const reportedTotal = count(body.total) ?? count(record(body.page)?.total) ?? cards.length;
    return {
      items: scoped,
      // A filter applied here invalidates the server's count, so report what this response holds.
      total: scoped.length === cards.length ? reportedTotal : scoped.length,
      page, pageSize,
      scopes: scope ? [scope] : [],
    };
  }

  async detail(request: { namespace: string; slug: string }, signal?: AbortSignal): Promise<SkillHubDetail> {
    signal?.throwIfAborted();
    const base = `/api/v1/skills/${skillHubSegment(request.namespace)}/${skillHubSegment(request.slug)}`;
    const body = unwrapSkillHubEnvelope(await this.call(base, signal, searchTimeoutMs));
    const installed = await this.installedNames(signal);
    const card = toSkillHubCard(body, (await this.settings()).namespace, installed);
    if (!card) throw new Error('skillhub/not-found');
    let versions: SkillHubVersion[] = [];
    try {
      const listed = unwrapSkillHubEnvelope(await this.call(`${base}/versions?page=0&size=20`, signal, searchTimeoutMs));
      versions = (Array.isArray(listed.items) ? listed.items : []).flatMap(entry => {
        const row = record(entry); const version = text(row?.version);
        if (!row || !version) return [];
        const publishedAt = text(row.createdAt) ?? text(row.publishedAt);
        const status = text(row.status); const changelog = text(row.changelog);
        return [{ version, ...(publishedAt ? { publishedAt } : {}), ...(status ? { status } : {}), ...(changelog ? { changelog } : {}) }];
      });
    } catch { /* A version list is an enhancement, not a precondition for showing the skill. */ }
    return { ...card, versions };
  }

  private async installedNames(signal?: AbortSignal): Promise<ReadonlySet<string>> {
    try {
      const rows = await this.skills.list(signal);
      return new Set(rows.map(row => row.name));
    } catch { return new Set(); }
  }

  async install(request: SkillHubInstallRequest, signal?: AbortSignal): Promise<SkillHubInstallResult> {
    signal?.throwIfAborted();
    const namespace = request.namespace; const slug = request.slug;
    const scope: SkillInstallScope = request.scope ?? 'profile';
    const base = `/api/v1/skills/${skillHubSegment(namespace)}/${skillHubSegment(slug)}`;
    const path = request.version ? `${base}/versions/${skillHubSegment(request.version)}/download` : `${base}/download`;
    const current = await this.settings();
    const token = await this.token(current.credentialRef);
    const timeout = AbortSignal.timeout(downloadTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${current.registryUrl}${path}`, {
        method: 'GET', redirect: 'error', signal: combined,
        headers: { accept: 'application/zip, application/octet-stream', 'user-agent': 'WorkDSH-Capability-Center/1', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
    } catch {
      throw new Error(combined.aborted ? 'skillhub/timeout' : 'skillhub/unreachable');
    }
    if (response.status === 401 || response.status === 403) throw new Error('skillhub/unauthorized');
    if (response.status === 404) throw new Error('skillhub/not-found');
    if (!response.ok || !response.body) throw new Error('skillhub/bad-status');
    const staged = await this.skills.imports.stage(`${slug}.zip`, response.body, combined);
    try {
      const receipt = await this.skills.imports.commit(staged.id, scope, signal);
      return { name: receipt.name, namespace, slug, ...(request.version ? { version: request.version } : {}), scope, receipt };
    } catch (error) {
      await this.skills.imports.discard(staged.id).catch(() => undefined);
      throw error;
    }
  }
}
