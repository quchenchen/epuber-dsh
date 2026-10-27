import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

const id = z.string().min(1).max(512);
const iso = z.string().datetime();

/**
 * Connection settings for one WorkDSH member. The API key itself never enters
 * this record: `apiKeyRef` only names the `ctx.credentials` reference, whose
 * value is owned by the credential provider (environment or provider store).
 */
export const knowledgeConnectionSchema = z.object({
  baseUrl: z.string().url().max(2048),
  defaultKbId: id.optional(),
  apiKeyRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  timeoutMs: z.number().int().min(1_000).max(120_000),
});

export type KnowledgeConnection = z.infer<typeof knowledgeConnectionSchema>;

export const knowledgeStateSchema = z.object({
  schemaVersion: z.literal(1),
  owner: z.object({ organizationId: id, principalId: id }),
  connection: knowledgeConnectionSchema,
  updatedAt: iso,
});

export type KnowledgeConnectionState = z.infer<typeof knowledgeStateSchema>;

export const knowledgeDomainSpec = defineDomain({
  name: 'workdsh_knowledge',
  version: 1,
  layout: 'per-record',
  tables: { connections: domainTable<string, KnowledgeConnectionState>(knowledgeStateSchema) },
});

export const knowledgeStateKey = (organizationId: string, principalId: string): string =>
  `${organizationId}_${principalId}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 240);

/** Default endpoint of the local WeKnora deployment used during integration. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:18081';
/** Environment variable the default credential reference resolves from. */
export const DEFAULT_API_KEY_REF = 'WEKNORA_API_KEY';
export const DEFAULT_TIMEOUT_MS = 15_000;
