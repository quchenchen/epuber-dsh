import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-tools';
import { professionalAuthoringSkills, skillCreatorContent, skillCreatorMeta } from './authoring/professional.js';
import { SkillManager, type SkillManagerOptions } from './services/manager.js';
import { registerSkillManagementConnection } from './services/connection-api.js';
import { SkillHubManager, type SkillHubManagerOptions } from './services/skillhub.js';
import { registerSkillHubConnection } from './services/skillhub-api.js';
import { registerSkillLifecycleTools } from './services/lifecycle-tools.js';

export * from './services/manager.js';
export * from './shared.js';
export { SkillHubManager } from './services/skillhub.js';
export { registerSkillManagementConnection } from './services/connection-api.js';
export { registerSkillHubConnection } from './services/skillhub-api.js';
export { registerSkillLifecycleTools } from './services/lifecycle-tools.js';

export const name = 'epuberdsh-plugin-skills';
export const inject = ['skills', 'connection', 'tools', 'storageDomain', 'credentials'];

export { skillCreatorContent } from './authoring/professional.js';

export interface SkillsHostOptions extends SkillManagerOptions, SkillHubManagerOptions {}

export function applySkillsHost(ctx: Context, options: SkillsHostOptions = {}): void {
  const manager = new SkillManager(ctx, options);
  // The catalog bridge installs through the same verified import path as a
  // browser upload, so it needs the manager, not a parallel installer.
  new SkillHubManager(ctx, manager, options);
  for (const skill of professionalAuthoringSkills) {
    ctx.effect(() => ctx.skills.register({
      ...skill,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: fileURLToPath(new URL(`../resources/skills/${skill.name}/`, import.meta.url)) },
    }));
  }
  registerSkillManagementConnection(ctx);
  registerSkillHubConnection(ctx);
  registerSkillLifecycleTools(ctx);
  ctx.effect(() => ctx.skills.register({
    ...skillCreatorMeta,
    source: 'bundled',
    content: skillCreatorContent,
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../resources/skills/skill-creator', import.meta.url)) },
  }));
}

export const apply = applySkillsHost;
