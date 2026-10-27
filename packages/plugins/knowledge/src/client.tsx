import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon, type IconName } from 'workdsh-ui';
import { createKnowledgeClient } from './client/management.js';
import { KnowledgePanel } from './client/KnowledgePanel.js';

export const name = 'workdsh-knowledge-client';
export const inject = ['slots', 'layout'];

type KnowledgeNavIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<{ readonly icon: IconName }>;

function KnowledgeNavIcon({ icon }: KnowledgeNavIconProps) {
  return <Icon name={icon} />;
}

/**
 * Contributes the top-level 「知识库」 navigation entry and its main panel.
 * Both use public Slots: the sidebar entry id and the keyed `main` panel key are
 * the same string, which is what the layout uses to resolve a panel selection.
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'workdsh.knowledge.client');
  const management = createKnowledgeClient(lifetime.signal);

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'workdsh-knowledge',
    label: '知识库',
    order: 45,
    inject: () => ({ icon: 'library' as const }),
  }, KnowledgeNavIcon));

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'workdsh-knowledge',
    inject: () => ({ management, toggleNavigation: () => ctx.layout.toggleSidebar() }),
  }, KnowledgePanel));
}
