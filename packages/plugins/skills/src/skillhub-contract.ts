import type { SkillInstallScope, SkillMutationReceipt } from 'epuberdsh-contracts/skills';

/** Host-owned SkillHub connection facts. Safe for a configuration surface: no secret value ever travels here. */
export interface SkillHubSettingsView {
  readonly available: boolean;
  /** False when the connection is session-only: the local store refused the write and a restart loses it. */
  readonly persisted: boolean;
  /** False until a registry address has been saved; the surface then asks for one instead of searching. */
  readonly configured: boolean;
  readonly registryUrl: string;
  readonly namespace: string;
  readonly credentialRef: string;
  readonly credentialConfigured: boolean;
  readonly credentialWritable: boolean;
  readonly updatedAt?: string;
}

/**
 * A token is accepted only on write and never echoed back. Omitting it leaves
 * the stored credential untouched, so re-saving an address does not force the
 * user to paste the secret again.
 */
export interface SkillHubConfigureInput {
  readonly registryUrl: string;
  readonly namespace?: string;
  readonly credentialRef?: string;
  readonly token?: string;
}

/** One catalog row, already resolved against local installations. */
export interface SkillHubCard {
  readonly slug: string;
  readonly namespace: string;
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly owner?: string;
  readonly labels?: readonly string[];
  readonly downloads?: number;
  readonly updatedAt?: string;
  readonly installed: boolean;
}

export interface SkillHubSearchRequest {
  readonly query?: string;
  /** Empty string means "every namespace the token may see"; omit to use the configured one. */
  readonly namespace?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SkillHubSearchResult {
  readonly items: readonly SkillHubCard[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** The namespaces this result was scoped to; empty when unscoped. */
  readonly scopes: readonly string[];
}

export interface SkillHubVersion {
  readonly version: string;
  readonly publishedAt?: string;
  readonly changelog?: string;
  readonly status?: string;
}

export interface SkillHubDetail extends SkillHubCard {
  readonly versions: readonly SkillHubVersion[];
}

export interface SkillHubInstallRequest {
  readonly namespace: string;
  readonly slug: string;
  readonly version?: string;
  readonly scope?: SkillInstallScope;
}

export interface SkillHubInstallResult {
  readonly name: string;
  readonly namespace: string;
  readonly slug: string;
  readonly version?: string;
  readonly scope: SkillInstallScope;
  readonly receipt: SkillMutationReceipt;
}

export type SkillHubEndpoint = 'status' | 'configure' | 'forget' | 'search' | 'detail' | 'install';

export interface SkillHubManagementService {
  readonly contractVersion: 1;
  status(): Promise<SkillHubSettingsView>;
  configure(input: SkillHubConfigureInput): Promise<SkillHubSettingsView>;
  /** Removes the stored token as well as the address, so a shared machine keeps no access. */
  forget(): Promise<SkillHubSettingsView>;
  search(request: SkillHubSearchRequest, signal?: AbortSignal): Promise<SkillHubSearchResult>;
  detail(request: { namespace: string; slug: string }, signal?: AbortSignal): Promise<SkillHubDetail>;
  install(request: SkillHubInstallRequest, signal?: AbortSignal): Promise<SkillHubInstallResult>;
}
