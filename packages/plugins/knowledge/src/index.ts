import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-storage-domain';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-credentials';
import { KnowledgeService, type KnowledgeServiceOptions } from './services/knowledge-service.js';
import { registerKnowledgeConnection } from './remote/connection-api.js';
import { registerKnowledgeTools } from './tools/knowledge-tools.js';
import { registerKnowledgeContextInjection } from './runtime/context-injection.js';

export * from './services/weknora-client.js';
export * from './services/knowledge-service.js';
export * from './storage/domain.js';
export * from './remote/connection-api.js';
export * from './tools/knowledge-tools.js';
export * from './runtime/context-injection.js';

export const name = 'epuberdsh-plugin-knowledge';
export const inject = ['storageDomain', 'connection', 'tools', 'credentials', 'workdshIdentity', 'systemPrompt'];

export async function apply(ctx: Context, options: KnowledgeServiceOptions = {}): Promise<void> {
  await ctx.plugin(KnowledgeService, options);
  await ctx.plugin({
    name: 'workdsh-knowledge-integration',
    inject: [...inject, 'workdshKnowledge'],
    apply(integration: Context) {
      registerKnowledgeConnection(integration);
      registerKnowledgeTools(integration);
      registerKnowledgeContextInjection(integration);
    },
  });
}
