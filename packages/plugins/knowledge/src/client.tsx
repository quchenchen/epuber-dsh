import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { Icon, type IconName } from 'epuberdsh-ui';
import type { KnowledgeBase } from './services/knowledge-service.js';
import { createKnowledgeClient } from './client/management.js';
import { KnowledgePanel } from './client/KnowledgePanel.js';
import { KnowledgePicker } from './client/KnowledgePicker.js';

export const name = 'workdsh-knowledge-client';
/** Scroll/citation surface stays official: only slots, triggers and the session binding are used. */
export const inject = ['slots', 'layout', 'conversation', 'sessions', 'inputTriggers'];

/** The `@` menu only accepts 'file' | 'folder' | 'session' or a component; the
 * knowledge index needs its own mark so it is not read as a file entry. */
const KnowledgeCandidateIcon = () => <Icon name="knowledge" size={16} />;

type KnowledgeNavIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<{ readonly icon: IconName }>;

/** One `@知识库` reference: the base is addressed by id, the name is a display label. */
interface KnowledgeRef {
  readonly kbId: string;
  readonly name: string;
}

const encodeRef = (value: KnowledgeRef): string => encodeURIComponent(JSON.stringify(value));
const decodeRef = (value: string): KnowledgeRef => JSON.parse(decodeURIComponent(value)) as KnowledgeRef;

function KnowledgeNavIcon({ icon }: KnowledgeNavIconProps) {
  return <Icon name={icon} />;
}

/**
 * Contributes the top-level 「知识库」 navigation entry, its main panel, and the
 * conversation-side `@知识库` reference: a pick binds the Session to one remote
 * knowledge base, and the Host turns that binding into a system-prompt block
 * (see `runtime/context-injection.ts`). No knowledge content is copied locally.
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'workdsh.knowledge.client');
  const management = createKnowledgeClient(lifetime.signal);
  const sessions = ctx.sessions as unknown as ISessions;

  const openKnowledge = () => ctx.layout.selectPanel('workdsh-knowledge' as Parameters<typeof ctx.layout.selectPanel>[0]);

  const referenceOf = (value: KnowledgeRef): ReferenceInsert => ({
    source: 'workdsh-knowledge',
    ref: encodeRef(value),
    label: value.name,
    appearance: 'file',
    clipboardText: `@知识库/${value.name}`,
  });

  /** Persist the binding: union of the Session's current bases and the picked one. */
  const bind = (sessionId: string, kb: KnowledgeBase): void => {
    void management.selection(sessionId)
      .then(current => management.setSelection(sessionId, [
        ...current.filter(row => row.id !== kb.id).map(row => ({ id: row.id, name: row.name, ...(row.documentCount === undefined ? {} : { documentCount: row.documentCount }) })),
        { id: kb.id, name: kb.name, documentCount: kb.knowledgeCount },
      ]))
      .catch(() => undefined);
  };

  const insertReference = (sessionId: string, kb: KnowledgeBase): boolean => {
    const binding = sessions.binding(sessionId as never);
    if (!binding) return false;
    const input = ctx.conversation.input.for(binding.ctx);
    const state = input.state.getSnapshot();
    const offset = state.draft.length;
    const inserted = binding.ctx.bail(binding.ctx, 'slash/input-insert-reference', {
      reference: referenceOf({ kbId: kb.id, name: kb.name }),
      span: { start: offset, end: offset, draftRev: state.draftRev },
    }) === true;
    if (inserted) bind(sessionId, kb);
    return inserted;
  };

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'workdsh-knowledge',
    label: '知识库',
    order: 45,
    inject: () => ({ icon: 'knowledge' as const }),
  }, KnowledgeNavIcon));

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'workdsh-knowledge',
    inject: () => ({ management, toggleNavigation: () => ctx.layout.toggleSidebar() }),
  }, KnowledgePanel));

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'workdsh-knowledge-picker',
    order: 34,
    inject: () => ({ management, openKnowledge, addReference: (sessionId: string, kb: KnowledgeBase) => insertReference(sessionId, kb) }),
  }, KnowledgePicker));

  const source: InputTriggerSource = {
    trigger: '@', name: 'workdsh-knowledge', order: 26, showGroupTitle: true,
    candidates: async (_session, request) => {
      const kbs = await management.listKbs().catch(() => [] as readonly KnowledgeBase[]);
      const query = request.query.trim().toLowerCase();
      return kbs
        .filter(kb => !query || kb.name.toLowerCase().includes(query) || kb.description.toLowerCase().includes(query))
        .map(kb => ({
          name: kb.name,
          label: kb.name,
          description: `知识库 · ${kb.knowledgeCount} 篇文档`,
          icon: KnowledgeCandidateIcon,
          value: encodeRef({ kbId: kb.id, name: kb.name }),
        }));
    },
    onPick: pick => {
      if (!pick.candidate.value) return undefined;
      const value = decodeRef(pick.candidate.value);
      const sessionId = String(pick.session.sessionId);
      bind(sessionId, { id: value.kbId, name: value.name, description: '', knowledgeCount: 0 });
      return { insert: referenceOf(value) };
    },
    openReference: () => { openKnowledge(); return true; },
    codec: {
      clipboardText: ref => `@知识库/${decodeRef(ref).name}`,
      serialize: async ref => `@知识库/${decodeRef(ref).name}`,
    },
  };
  ctx.effect(() => ctx.inputTriggers.registerSource(source));
}
