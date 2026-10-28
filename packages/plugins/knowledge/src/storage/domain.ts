import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

const id = z.string().min(1).max(512);
const iso = z.string().datetime();

/**
 * Connection settings for one WorkDSH organization.
 *
 * Scope is deliberate: an endpoint plus a key reference describes where the
 * tenant's knowledge service lives, not a personal preference. One row serves
 * every member, so a new member is productive without configuring anything.
 * The API key itself never enters this record: `apiKeyRef` only names the
 * `ctx.credentials` reference, whose value is owned by the credential provider
 * (environment or provider store) and is already shared process-wide.
 */
export const knowledgeConnectionSchema = z.object({
  baseUrl: z.string().url().max(2048),
  defaultKbId: id.optional(),
  apiKeyRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  timeoutMs: z.number().int().min(1_000).max(120_000),
});

export type KnowledgeConnection = z.infer<typeof knowledgeConnectionSchema>;

/**
 * Version 1 stored one row per member. Those rows still exist on disk after an
 * upgrade, and `storageDomain.open` parses every record it finds — an
 * incompatible schema would therefore fail the whole plugin at startup, not
 * just that row. Version 1 stays readable but is never addressed again: the key
 * moved to `org:<id>`, so a legacy row is inert rather than fatal. Two members
 * could hold different endpoints, so there is no single value to migrate to;
 * an administrator confirms the shared settings once instead.
 */
const knowledgeStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  owner: z.object({ organizationId: id, principalId: id }),
  connection: knowledgeConnectionSchema,
  updatedAt: iso,
});

export const knowledgeStateSchema = z.object({
  schemaVersion: z.literal(2),
  organizationId: id,
  /** Whoever last wrote the shared settings, for the audit trail in the panel. */
  updatedBy: id.optional(),
  connection: knowledgeConnectionSchema,
  updatedAt: iso,
});

/** What the domain accepts from disk: a legacy row must never fail the open. */
export const knowledgeStateStoredSchema = z.discriminatedUnion('schemaVersion', [
  knowledgeStateV1Schema,
  knowledgeStateSchema,
]);

export type KnowledgeConnectionState = z.infer<typeof knowledgeStateSchema>;
export type KnowledgeConnectionRow = z.infer<typeof knowledgeStateStoredSchema>;

/**
 * One knowledge base a member explicitly added to a conversation. Only the
 * `@知识库` binding lives here: the base is addressed by id, and the display
 * name is a cache refreshed on every write. Retrieved chunk text is never
 * stored — the model fetches it through `knowledge_search` on demand.
 */
export const knowledgeSelectionEntrySchema = z.object({
  id,
  name: z.string().max(512),
  documentCount: z.number().int().nonnegative().optional(),
});

export type KnowledgeSelectionEntry = z.infer<typeof knowledgeSelectionEntrySchema>;

export const knowledgeSelectionSchema = z.object({
  schemaVersion: z.literal(1),
  owner: z.object({ organizationId: id, principalId: id }),
  sessionId: id,
  knowledgeBases: z.array(knowledgeSelectionEntrySchema).max(8),
  updatedAt: iso,
});

export type KnowledgeSelectionState = z.infer<typeof knowledgeSelectionSchema>;

export const knowledgeDomainSpec = defineDomain({
  name: 'workdsh_knowledge',
  version: 1,
  layout: 'per-record',
  tables: {
    connections: domainTable<string, KnowledgeConnectionRow>(knowledgeStateStoredSchema),
    selections: domainTable<string, KnowledgeSelectionState>(knowledgeSelectionSchema),
  },
});

/**
 * Settings are organization-scoped, so the key carries no principal: every
 * member reads the same row. A pre-existing per-member row from version 1 is
 * simply not addressed any more; the connection falls back to the composed
 * defaults and is written once by an administrator.
 */
export const knowledgeStateKey = (organizationId: string): string =>
  `org_${organizationId}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 240);

/** Selection records stay member-scoped: a Session binding belongs to its owner. */
export const knowledgeSelectionKey = (organizationId: string, principalId: string, sessionId: string): string =>
  `${organizationId}_${principalId}_${sessionId}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 240);

/** Default endpoint of the local WeKnora deployment used during integration. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:18081';
/** Environment variable the default credential reference resolves from. */
export const DEFAULT_API_KEY_REF = 'WEKNORA_API_KEY';
export const DEFAULT_TIMEOUT_MS = 15_000;
