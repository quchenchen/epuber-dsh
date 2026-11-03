import * as React from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon } from 'epuberdsh-ui';
import type { KnowledgeBase } from '../services/knowledge-service.js';
import type { KnowledgeClient } from './management.js';

type Props = PropsRuntime<'conversation.input.left'> & {
  management: KnowledgeClient;
  openKnowledge: () => void;
  addReference: (sessionId: string, kb: KnowledgeBase) => boolean;
};

const css = `
.wd-kb-picker{position:relative;display:flex;align-items:center}
.wd-kb-picker-trigger{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.wd-kb-picker-trigger:hover,.wd-kb-picker-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-kb-popover{position:absolute;z-index:90;left:0;bottom:calc(100% + 10px);width:340px;max-height:min(430px,60vh);overflow:auto;padding:8px;border-radius:15px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font:14px/20px "PingFang SC","Microsoft YaHei",sans-serif}
.wd-kb-head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 8px;color:var(--dsw-alias-label-secondary);font-size:11px}
.wd-kb-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 5px;border-radius:10px}
.wd-kb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-kb-main{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:center;min-width:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;padding:0;cursor:pointer}
.wd-kb-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}
.wd-kb-copy{min-width:0}
.wd-kb-copy strong,.wd-kb-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-kb-copy small{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:11px}
.wd-kb-action{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:6px 8px;border-radius:8px}
.wd-kb-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-kb-manage{display:flex;gap:8px;width:100%;margin-top:6px;padding:10px 9px;border-top:1px solid var(--dsw-alias-border-l2);border-top-left-radius:0;border-top-right-radius:0;border-bottom:0;border-left:0;border-right:0;background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:left}
.wd-kb-manage:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-kb-status{padding:12px;color:var(--dsw-alias-label-secondary)}
@media(max-width:560px){.wd-kb-popover{position:fixed;left:12px;right:12px;bottom:86px;width:auto}}
`;

/**
 * Composer-side entry to the knowledge surface: pick one knowledge base and the
 * conversation is bound to it, so every turn retrieves with that `kb_id` and
 * cites real chunk ids. Distinct from `@file` — nothing is uploaded or read
 * locally; the base stays remote.
 */
export function KnowledgePicker({ sessionId, management, openKnowledge, addReference }: Props) {
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<readonly KnowledgeBase[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(''); setNotice(''); setRows([]);
    void management.listKbs()
      .then(items => { if (!cancelled) setRows(items); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '无法加载知识库，请检查连接设置。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, management]);

  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const pick = (kb: KnowledgeBase) => {
    if (addReference(String(sessionId), kb)) setOpen(false);
    else setNotice('输入框尚未就绪，请稍后重试。');
  };

  return <>
    <style>{css}</style>
    <div className="wd-kb-picker" ref={root}>
      <button ref={trigger} type="button" className="wd-kb-picker-trigger" aria-label="从知识库添加到对话" aria-haspopup="dialog" aria-expanded={open} title="从知识库添加到对话"
        onClick={() => setOpen(value => !value)}><Icon name="knowledge" size={22} /></button>
      {open && <div className="wd-kb-popover" role="dialog" aria-label="知识库">
        <div className="wd-kb-head"><span>引用知识库（回答前会先检索）</span><span>{rows.length ? `${rows.length} 个` : ''}</span></div>
        {loading && <div className="wd-kb-status" role="status">正在加载知识库…</div>}
        {error && <div className="wd-kb-status" role="alert">{error}</div>}
        {notice && <div className="wd-kb-status" role="alert">{notice}</div>}
        {!loading && !error && !rows.length && <div className="wd-kb-status">还没有知识库，可在知识库面板中新建。</div>}
        {rows.map(kb => <div className="wd-kb-row" key={kb.id}>
          <button className="wd-kb-main" type="button" onClick={() => pick(kb)}>
            <span className="wd-kb-mark"><Icon name="knowledge" /></span>
            <span className="wd-kb-copy"><strong>{kb.name}</strong><small>{kb.knowledgeCount} 篇文档{kb.description ? ` · ${kb.description}` : ''}</small></span>
          </button>
          <button className="wd-kb-action" type="button" aria-label={`引用 ${kb.name}`} onClick={() => pick(kb)}>引用</button>
        </div>)}
        <button className="wd-kb-manage" type="button" onClick={() => { setOpen(false); openKnowledge(); }}><span aria-hidden="true">↗</span>打开知识库面板</button>
      </div>}
    </div>
  </>;
}
