import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-storage-domain';
import type {} from '@deepseek-ai/dsh-client-connection';
import { ProjectManager } from './services/project-manager.js';
import { registerProjectConnection } from './remote/connection-api.js';
import { registerProjectContextInjection } from './runtime/context-injection.js';
import { registerDeliverableAttribution } from './runtime/deliverable-attribution.js';
export * from './services/project-manager.js'; export * from './storage/domain.js';
export const name='epuberdsh-plugin-projects';
export const inject=['storageDomain','connection','epuberdshIdentity'];
export interface ProjectOptions { readonly workspaceRoot?: string; }
export async function apply(ctx:Context,options:ProjectOptions={}){
  await ctx.plugin(ProjectManager);
  await ctx.plugin({
    name:'epuberdsh-projects-integration',
    inject:[...inject,'systemPrompt','epuberdshProjects','workspaceController'],
    apply(integration:Context){registerProjectConnection(integration,options.workspaceRoot);registerProjectContextInjection(integration);},
  });
  await ctx.plugin({
    name:'epuberdsh-projects-attribution',
    inject:['fs','epuberdshLibrary','epuberdshProjects','epuberdshIdentity'],
    apply(attribution:Context){registerDeliverableAttribution(attribution);},
  });
}
