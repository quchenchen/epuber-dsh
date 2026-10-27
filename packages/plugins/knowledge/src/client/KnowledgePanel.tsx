import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from 'workdsh-ui';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgePreview,
  KnowledgeSearchHit,
  KnowledgeSearchMode,
  KnowledgeSettings,
} from '../services/knowledge-service.js';
import { fileBase64, type KnowledgeClient } from './management.js';
import { knowledgeCss } from './styles.js';

type Props = PropsRuntime<'main'> & InjectFace<{ management: KnowledgeClient; toggleNavigation: () => void }>;
type View = 'kbs' | 'search' | 'settings';
type SettingsForm = { baseUrl: string; apiKey: string; defaultKbId: string };
type CreateForm = { name: string; description: string; templateKbId: string };
type ConfirmState =
  | { readonly kind: 'delete-document'; readonly document: KnowledgeDocument }
  | { readonly kind: 'delete-kb'; readonly kb: KnowledgeBase };

const docsPageSize = 20;
const chunksPageSize = 10;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const message = (cause: unknown): string => cause instanceof Error ? cause.message : '知识库操作失败。';
const formatBytes = (value: number | undefined): string => {
  if (value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};
const formatTime = (value: string | undefined): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false });
};
const modeLabel: Record<KnowledgeSearchMode, string> = { hybrid: '混合检索', semantic: '语义检索', keyword: '关键词检索' };
const isProcessing = (document: KnowledgeDocument | undefined): boolean => document?.parseStatus === 'pending' || document?.parseStatus === 'processing';

export function KnowledgePanel({ management, toggleNavigation }: Props) {
  const [view, setView] = useState<View>('kbs');
  const [settings, setSettings] = useState<KnowledgeSettings>();
  const [form, setForm] = useState<SettingsForm>({ baseUrl: '', apiKey: '', defaultKbId: '' });
  const [kbs, setKbs] = useState<readonly KnowledgeBase[]>([]);
  const [filter, setFilter] = useState('');
  const [kb, setKb] = useState<KnowledgeBase>();
  const [docs, setDocs] = useState<readonly KnowledgeDocument[]>([]);
  const [docsPage, setDocsPage] = useState(1);
  const [docsTotal, setDocsTotal] = useState<number>();
  const [doc, setDoc] = useState<KnowledgeDocument>();
  const [preview, setPreview] = useState<KnowledgePreview>();
  const [chunks, setChunks] = useState<readonly KnowledgeChunk[]>([]);
  const [chunkPage, setChunkPage] = useState(1);
  const [chunkTotal, setChunkTotal] = useState<number>();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<KnowledgeSearchMode>('hybrid');
  const [hits, setHits] = useState<readonly KnowledgeSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({ name: '', description: '', templateKbId: '' });
  const [confirm, setConfirm] = useState<ConfirmState>();
  const [kbDeleteName, setKbDeleteName] = useState('');
  const [deletingId, setDeletingId] = useState<string>();
  const generation = useRef(0);
  const upload = useRef<HTMLInputElement>(null);

  const run = useCallback(async (task: () => Promise<void>) => {
    const current = ++generation.current;
    setBusy(true); setError('');
    try { await task(); }
    catch (cause) { if (current === generation.current) setError(message(cause)); }
    finally { if (current === generation.current) setBusy(false); }
  }, []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(current => current === text ? '' : current), 3200);
  }, []);

  const loadSettings = useCallback(async () => {
    const next = await management.settings();
    setSettings(next);
    setForm({ baseUrl: next.baseUrl, apiKey: '', defaultKbId: next.defaultKbId ?? '' });
  }, [management]);

  const loadKbs = useCallback(async () => {
    try { setKbs(await management.listKbs()); } catch (cause) { setError(message(cause)); }
  }, [management]);

  useEffect(() => {
    void run(async () => {
      await loadSettings();
      await loadKbs();
    });
  }, [run, loadSettings, loadKbs]);

  const loadDocs = useCallback(async (kbId: string, page: number) => {
    const result = await management.listDocuments(kbId, { page, pageSize: docsPageSize });
    setDocs(result.items); setDocsPage(result.page); setDocsTotal(result.total);
  }, [management]);

  const loadChunks = useCallback(async (knowledgeId: string, page: number) => {
    const result = await management.listChunks(knowledgeId, { page, pageSize: chunksPageSize });
    setChunks(result.items); setChunkPage(result.page); setChunkTotal(result.total);
  }, [management]);

  // Refresh a document that is still being parsed and reload its preview once settled.
  useEffect(() => {
    const pendingInList = docs.some(isProcessing);
    const pendingCurrent = isProcessing(doc);
    if (!pendingInList && !pendingCurrent) return;
    const timer = window.setInterval(() => {
      if (kb) void management.listDocuments(kb.id, { page: docsPage, pageSize: docsPageSize }).then(result => { setDocs(result.items); setDocsTotal(result.total); }).catch(() => undefined);
      if (doc) void management.getDocument(doc.id).then(next => {
        if (next.id !== doc.id || next.parseStatus === doc.parseStatus) return;
        setDoc(next);
        if (next.parseStatus === 'completed') {
          void management.getPreview(next.id).then(setPreview).catch(() => undefined);
          void management.listChunks(next.id, { page: 1, pageSize: chunksPageSize }).then(result => { setChunks(result.items); setChunkPage(result.page); setChunkTotal(result.total); }).catch(() => undefined);
          flash('解析完成。');
        } else if (next.parseStatus === 'failed') flash('解析失败，请查看失败原因。');
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [docs, doc, kb, docsPage, management, flash]);

  // WeKnora deletes documents asynchronously; poll the list until the row disappears.
  useEffect(() => {
    if (!deletingId || !kb) return;
    const timer = window.setInterval(() => {
      void management.listDocuments(kb.id, { page: docsPage, pageSize: docsPageSize }).then(async result => {
        setDocs(result.items); setDocsTotal(result.total);
        if (!result.items.some(item => item.id === deletingId)) {
          setDeletingId(undefined);
          flash('文档已删除。');
          if (!result.items.length && docsPage > 1) await loadDocs(kb.id, docsPage - 1).catch(() => undefined);
          // The async delete task can make the row visible once more; re-read after a short settle.
          window.setTimeout(() => {
            void management.listDocuments(kb.id, { page: docsPage, pageSize: docsPageSize }).then(next => { setDocs(next.items); setDocsTotal(next.total); }).catch(() => undefined);
            void loadKbs();
          }, 2_500);
        }
      }).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [deletingId, kb, docsPage, management, flash, loadDocs]);

  const openKb = (nextKb: KnowledgeBase) => {
    setKb(nextKb); setDoc(undefined); setPreview(undefined); setHits([]); setSearched(false); setView('kbs');
    setDocs([]); setDocsPage(1); setDocsTotal(undefined);
    void run(async () => { await loadDocs(nextKb.id, 1); });
  };

  const openDoc = (nextDoc: KnowledgeDocument) => {
    setDoc(nextDoc); setPreview(undefined); setChunks([]); setChunkPage(1); setChunkTotal(undefined);
    void run(async () => {
      const [nextPreview] = await Promise.all([
        management.getPreview(nextDoc.id),
        loadChunks(nextDoc.id, 1),
      ]);
      setPreview(nextPreview);
    });
  };

  const openFromHit = (hit: KnowledgeSearchHit) => {
    const target = kbs.find(item => item.id === hit.knowledgeBaseId) ?? kb;
    if (target) setKb(target);
    setView('kbs');
    void run(async () => {
      const nextDoc = await management.getDocument(hit.knowledgeId);
      openDoc(nextDoc);
    });
  };

  const stepDocs = (page: number) => {
    if (!kb) return;
    void run(async () => { await loadDocs(kb.id, page); });
  };

  const stepChunks = (page: number) => {
    if (!doc) return;
    void run(async () => { await loadChunks(doc.id, page); });
  };

  const search = () => {
    const text = query.trim();
    if (!text) { setError('请输入检索关键词。'); return; }
    setSearched(true);
    void run(async () => {
      const nextHits = await management.search({ query: text, ...(kb ? { kbId: kb.id } : {}), matchCount: 10, mode });
      setHits(nextHits);
    });
  };

  const saveSettings = () => {
    void run(async () => {
      const next = await management.updateSettings({
        baseUrl: form.baseUrl.trim(),
        defaultKbId: form.defaultKbId.trim() ? form.defaultKbId.trim() : null,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      });
      setSettings(next);
      setForm({ baseUrl: next.baseUrl, apiKey: '', defaultKbId: next.defaultKbId ?? '' });
      flash('知识库连接设置已保存。');
      await loadKbs();
    });
  };

  const openCreate = () => {
    setCreateForm({ name: '', description: '', templateKbId: settings?.defaultKbId ?? kbs[0]?.id ?? '' });
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const name = createForm.name.trim();
    if (!name) { setError('请输入知识库名称。'); return; }
    const input: KnowledgeBaseCreateInput = {
      name,
      ...(createForm.description.trim() ? { description: createForm.description.trim() } : {}),
      ...(createForm.templateKbId ? { templateKbId: createForm.templateKbId } : {}),
    };
    void run(async () => {
      const created = await management.createKb(input);
      setCreateOpen(false);
      setCreateForm({ name: '', description: '', templateKbId: '' });
      flash(`已创建知识库「${created.name}」。`);
      await loadKbs();
      setKb(created); setDoc(undefined); setPreview(undefined); setDocs([]); setDocsPage(1); setDocsTotal(undefined); setView('kbs');
      await loadDocs(created.id, 1);
    });
  };

  const pickUpload = () => { if (kb) upload.current?.click(); };

  const onUpload = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !kb) return;
    if (file.size > MAX_UPLOAD_BYTES) { setError('文件超过 50MB 上传上限。'); return; }
    setUploading(true);
    void run(async () => {
      const base64 = await fileBase64(file);
      const created = await management.uploadDocument(kb.id, {
        fileName: file.name,
        base64,
        ...(file.type ? { mediaType: file.type } : {}),
      });
      flash(`已上传「${created.title}」，解析中…`);
      void loadKbs();
      await loadDocs(kb.id, 1);
    }).finally(() => { setUploading(false); if (upload.current) upload.current.value = ''; });
  };

  const reparse = () => {
    if (!doc) return;
    void run(async () => {
      const next = await management.reparseDocument(doc.id);
      setDoc(next);
      flash('已提交重新解析，等待解析完成…');
      if (kb) await loadDocs(kb.id, docsPage);
    });
  };

  const submitDeleteDocument = () => {
    if (confirm?.kind !== 'delete-document') return;
    const target = confirm.document;
    void run(async () => {
      await management.deleteDocument(target.id);
      setConfirm(undefined);
      setDoc(undefined);
      setPreview(undefined);
      setDeletingId(target.id);
      flash('删除任务已提交，等待列表刷新…');
      if (kb) await loadDocs(kb.id, docsPage);
    });
  };

  const submitDeleteKb = () => {
    if (confirm?.kind !== 'delete-kb') return;
    const target = confirm.kb;
    void run(async () => {
      await management.deleteKb(target.id);
      setConfirm(undefined);
      setKbDeleteName('');
      if (kb?.id === target.id) { setKb(undefined); setDoc(undefined); setPreview(undefined); }
      flash(`知识库「${target.name}」已删除。`);
      let rows = await management.listKbs();
      for (let attempt = 0; attempt < 8 && rows.some(row => row.id === target.id); attempt += 1) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 1200));
        rows = await management.listKbs();
      }
      setKbs(rows);
    });
  };

  const visibleKbs = filter.trim() ? kbs.filter(item => item.name.toLowerCase().includes(filter.trim().toLowerCase())) : kbs;
  const docsHasNext = docsTotal !== undefined ? docsPage * docsPageSize < docsTotal : docs.length === docsPageSize;
  const chunksHasNext = chunkTotal !== undefined ? chunkPage * chunksPageSize < chunkTotal : chunks.length === chunksPageSize;

  const statusBadge = (value: KnowledgeDocument) => <span className={`wd-knowledge-badge ${value.parseStatus}`} data-testid="parse-status-badge">{value.parseStatusLabel}</span>;

  const kbListView = <div className="wd-knowledge-body">
    <div className="wd-knowledge-toolbar">
      <div><h2>知识库</h2><small>来自 WeKnora 知识库服务</small></div>
      <div className="wd-knowledge-toolbar-actions"><Button variant="primary" data-testid="create-kb-button" disabled={busy} onClick={openCreate}>新建知识库</Button></div>
    </div>
    {kbs.length === 0
      ? <div className="wd-knowledge-state">还没有可用的知识库。请检查连接设置与凭据。</div>
      : <div className="wd-knowledge-kb-grid">{visibleKbs.map(item => <button key={item.id} type="button" className="wd-knowledge-kb-card" data-testid="kb-card" onClick={() => openKb(item)}>
          <h3>{item.name}</h3>
          <p>{item.description || '（无描述）'}</p>
          <span className="wd-knowledge-kb-meta"><span>{item.knowledgeCount} 篇文档</span>{item.updatedAt ? <span>更新于 {formatTime(item.updatedAt)}</span> : null}</span>
        </button>)}</div>}
  </div>;

  const docListView = <div className="wd-knowledge-body">
    {kb ? <>
      <div className="wd-knowledge-toolbar">
        <div><h2>{kb.name}</h2><small>{docsTotal === undefined ? `${kb.knowledgeCount} 篇文档` : `当前共 ${docsTotal} 篇文档`}</small></div>
        <div className="wd-knowledge-toolbar-actions">
          <Button variant="primary" data-testid="upload-document-button" disabled={busy || uploading} onClick={pickUpload}>{uploading ? '上传中…' : '上传文档'}</Button>
          <Button tone="danger" data-testid="delete-kb-button" disabled={busy} onClick={() => { setKbDeleteName(''); setConfirm({ kind: 'delete-kb', kb }); }}>删除知识库</Button>
          <Button onClick={() => { setKb(undefined); setDocs([]); }}>返回知识库</Button>
        </div>
      </div>
      <input ref={upload} className="wd-knowledge-upload" data-testid="upload-input" type="file" multiple={false} accept=".md,.markdown,.txt,.pdf,.docx,.pptx,.csv,.xlsx,.html,.htm,.json" onChange={event => onUpload(event.currentTarget.files)} />
      {docs.length === 0
        ? <div className="wd-knowledge-state">该知识库当前没有文档。可点击「上传文档」导入文件。</div>
        : <div className="wd-knowledge-list" data-testid="doc-list">{docs.map(item => <button key={item.id} type="button" className="wd-knowledge-doc" data-testid="doc-item" onClick={() => openDoc(item)}>
            <span className="wd-knowledge-doc-main">
              <strong>{item.title}</strong>
              <small>{item.fileType?.toUpperCase() ?? '文件'} · {formatBytes(item.sizeBytes)} · 更新于 {formatTime(item.updatedAt)}</small>
            </span>
            {statusBadge(item)}
          </button>)}</div>}
      <div className="wd-knowledge-pager">
        <Button disabled={busy || docsPage <= 1} onClick={() => stepDocs(docsPage - 1)}>上一页</Button>
        <span>第 {docsPage} 页</span>
        <Button disabled={busy || !docsHasNext} onClick={() => stepDocs(docsPage + 1)}>下一页</Button>
      </div>
    </> : <div className="wd-knowledge-state">请选择一个知识库。</div>}
  </div>;

  const docDetailView = doc ? <div className="wd-knowledge-body">
    <div className="wd-knowledge-toolbar">
      <div><h2>{doc.title}</h2><small>{doc.knowledgeBaseName ?? kb?.name ?? doc.knowledgeBaseId}</small></div>
      <div className="wd-knowledge-toolbar-actions">
        <Button data-testid="reparse-document-button" disabled={busy || isProcessing(doc)} onClick={reparse}>重新解析</Button>
        <Button tone="danger" data-testid="delete-document-button" disabled={busy} onClick={() => setConfirm({ kind: 'delete-document', document: doc })}>删除文档</Button>
        <Button onClick={() => { setDoc(undefined); setPreview(undefined); }}>返回文档列表</Button>
      </div>
    </div>
    <div className="wd-knowledge-doc-detail">
      <div className="wd-knowledge-meta">
        {statusBadge(doc)}
        <span>类型 {doc.fileType?.toUpperCase() ?? '—'}</span>
        <span>大小 {formatBytes(doc.sizeBytes)}</span>
        <span>更新 {formatTime(doc.updatedAt)}</span>
        <span>knowledge_id {doc.id}</span>
      </div>
      {doc.errorMessage ? <div className="wd-knowledge-warning" role="note">解析失败原因：{doc.errorMessage}</div> : null}
      {isProcessing(doc) ? <div className="wd-knowledge-hint" data-testid="processing-hint">解析中，页面每 4 秒自动刷新；解析完成后可查看分块与检索结果。</div> : null}
      <section className="wd-knowledge-section">
        <header><strong>预览文本</strong><small>{preview ? (preview.source === 'original' ? `原始文件前 ${formatBytes(preview.byteLength)}` : '由已解析分块拼接') : '加载中…'}</small></header>
        <pre className="wd-knowledge-preview" data-testid="preview-text">{preview?.text?.trim() ? preview.text : (preview ? '（没有可预览的文本）' : '正在读取预览…')}</pre>
      </section>
      <section className="wd-knowledge-section">
        <header><strong>分块列表</strong><small>{chunkTotal === undefined ? `第 ${chunkPage} 页` : `第 ${chunkPage} 页 · 共 ${chunkTotal} 块`}</small></header>
        <div className="wd-knowledge-chunks" data-testid="chunk-list">
          {chunks.length === 0 ? <div className="wd-knowledge-state">{isProcessing(doc) ? '解析完成后显示分块。' : '该文档没有解析出的分块。'}</div> : chunks.map(chunk => <div className="wd-knowledge-chunk" key={chunk.id} data-testid="chunk-item">
            <b>#{chunk.chunkIndex} · {chunk.id}</b>
            <p>{chunk.content}</p>
          </div>)}
        </div>
      </section>
      <div className="wd-knowledge-pager">
        <Button disabled={busy || chunkPage <= 1} onClick={() => stepChunks(chunkPage - 1)}>上一页</Button>
        <span>第 {chunkPage} 页</span>
        <Button disabled={busy || !chunksHasNext} onClick={() => stepChunks(chunkPage + 1)}>下一页</Button>
      </div>
    </div>
  </div> : null;

  const searchView = <div className="wd-knowledge-body">
    <div className="wd-knowledge-toolbar"><div><h2>检索</h2><small>{kb ? `当前知识库：${kb.name}` : '未限定知识库，使用默认知识库'}</small></div></div>
    <form className="wd-knowledge-search-form" onSubmit={event => { event.preventDefault(); search(); }}>
      <Input aria-label="检索关键词" data-testid="search-input" value={query} placeholder="输入自然语言问题或关键词，例如：新型电力系统 规划 目标" onChange={event => setQuery(event.currentTarget.value)} />
      <Select aria-label="检索模式" data-testid="search-mode" value={mode} onChange={event => setMode(event.currentTarget.value as KnowledgeSearchMode)}>
        <option value="hybrid">混合检索</option>
        <option value="semantic">语义检索</option>
        <option value="keyword">关键词检索</option>
      </Select>
      <Button type="submit" variant="primary" data-testid="search-submit" disabled={busy}>检索</Button>
    </form>
    <div className="wd-knowledge-search-mode"><span>模式：{modeLabel[mode]}</span><span>·</span><span>结果带 knowledge_title、相关度与原文片段</span></div>
    {busy && !hits.length ? <div className="wd-knowledge-state">正在检索…</div> : null}
    {searched && !busy && hits.length === 0 ? <div className="wd-knowledge-state">没有检索到匹配内容。</div> : null}
    <div className="wd-knowledge-hits">{hits.map(hit => <article className="wd-knowledge-hit" key={`${hit.knowledgeId}-${hit.chunkId}`} data-testid="search-hit">
      <div className="wd-knowledge-hit-head"><strong>{hit.knowledgeTitle}</strong><span className="wd-knowledge-score" data-testid="hit-score">score {hit.score.toFixed(3)}</span></div>
      <p>{hit.content.length > 420 ? `${hit.content.slice(0, 420)}…` : hit.content}</p>
      <footer>
        <span>{kb?.name ?? hit.knowledgeBaseId}</span>
        <span>knowledge_id {hit.knowledgeId}</span>
        <span>chunk_id {hit.chunkId}</span>
        <button type="button" onClick={() => openFromHit(hit)}>打开文档</button>
      </footer>
    </article>)}</div>
  </div>;

  const settingsView = <div className="wd-knowledge-body">
    <div className="wd-knowledge-toolbar"><div><h2>连接设置</h2><small>API Key 只写不读，由 Host 凭据服务持有</small></div></div>
    <div className="wd-knowledge-form">
      <label>服务地址
        <Input data-testid="settings-base-url" value={form.baseUrl} placeholder="http://127.0.0.1:18081" onChange={event => setForm({ ...form, baseUrl: event.currentTarget.value })} />
        <small>WeKnora REST /api/v1 的部署地址，例如本机 http://127.0.0.1:18081。</small>
      </label>
      <label>默认知识库（可选）
        <Select data-testid="settings-default-kb" value={form.defaultKbId} onChange={event => setForm({ ...form, defaultKbId: event.currentTarget.value })}>
          <option value="">不设置默认知识库</option>
          {kbs.map(item => <option key={item.id} value={item.id}>{item.name}（{item.knowledgeCount} 篇）</option>)}
        </Select>
        <small>检索与新建知识库的模板默认使用。</small>
      </label>
      <label>API Key
        <Input data-testid="settings-api-key" type="password" value={form.apiKey} placeholder={settings?.apiKeyConfigured ? '已配置（留空则保持不变）' : '输入租户 API Key'} onChange={event => setForm({ ...form, apiKey: event.currentTarget.value })} />
        <small>凭据引用 {settings?.apiKeyRef ?? 'WEKNORA_API_KEY'} · {settings ? (settings.apiKeyConfigured ? `已配置（来源：${settings.apiKeySource ?? '未知'}）` : '未配置') : '读取中…'}。也可通过同名环境变量提供，密钥不会写入存储或日志。</small>
      </label>
      <div className="wd-knowledge-form-actions">
        <Button variant="primary" data-testid="settings-save" disabled={busy} onClick={saveSettings}>保存设置</Button>
        <span>{busy ? '保存中…' : ''}</span>
      </div>
    </div>
  </div>;

  const content = view === 'settings' ? settingsView
    : view === 'search' ? searchView
      : doc ? docDetailView : kb ? docListView : kbListView;

  const deletingKb = confirm?.kind === 'delete-kb' ? confirm.kb : undefined;

  return <section className="wd-knowledge">
    <style>{knowledgeCss}</style>
    {notice ? <div className="wd-knowledge-toast success" role="status">{notice}</div> : null}
    {error ? <div className="wd-knowledge-toast error" role="alert" data-testid="knowledge-error">{error}</div> : null}
    <aside className="wd-knowledge-sidebar">
      <header><button type="button" className="wd-knowledge-nav-toggle" aria-label="展开导航" onClick={toggleNavigation}>☰</button><h1>知识库</h1></header>
      <nav className="wd-knowledge-nav">
        <button type="button" className={view === 'kbs' ? 'active' : ''} data-testid="nav-kbs" onClick={() => setView('kbs')}>▤ <span>知识库</span></button>
        <button type="button" className={view === 'search' ? 'active' : ''} data-testid="nav-search" onClick={() => setView('search')}>⌕ <span>检索</span></button>
        <button type="button" className={view === 'settings' ? 'active' : ''} data-testid="nav-settings" onClick={() => setView('settings')}>⚙ <span>设置</span></button>
      </nav>
      <div className="wd-knowledge-section-title"><span>知识库</span><button type="button" data-testid="create-kb-plus" title="新建知识库" aria-label="新建知识库" onClick={openCreate}>＋</button></div>
      <div className="wd-knowledge-filter"><Input aria-label="筛选知识库" value={filter} placeholder="筛选知识库…" onChange={event => setFilter(event.currentTarget.value)} /></div>
      <div className="wd-knowledge-kbs">
        {visibleKbs.map(item => <button type="button" key={item.id} className={`wd-knowledge-kb${kb?.id === item.id ? ' active' : ''}`} data-testid="kb-item" onClick={() => openKb(item)}>
          <span className="wd-knowledge-kb-glyph">▤</span>
          <span className="wd-knowledge-kb-name">{item.name}</span>
          <span className="wd-knowledge-kb-count">{item.knowledgeCount}</span>
        </button>)}
      </div>
      <footer>
        <span>{settings ? settings.baseUrl : '连接设置读取中…'}</span>
        <span>{settings ? (settings.apiKeyConfigured ? `凭据已配置（${settings.apiKeySource ?? '凭据服务'}）` : '凭据未配置') : ''}</span>
        <span>WeKnora · 只读 + 管理（P2）</span>
      </footer>
    </aside>
    <main className="wd-knowledge-content">{content}</main>

    <Modal open={createOpen} label="新建知识库" className="wd-knowledge-dialog" onClose={() => setCreateOpen(false)}>
      <h2>新建知识库</h2>
      <p className="wd-knowledge-dialog-hint">新知识库会继承「模板知识库」的向量模型与分块配置，并启用向量 + 关键词索引。</p>
      <label>名称
        <Input data-testid="create-kb-name" value={createForm.name} placeholder="例如：WorkDSH 插件联调" onChange={event => setCreateForm({ ...createForm, name: event.currentTarget.value })} />
      </label>
      <label>描述（可选）
        <Textarea data-testid="create-kb-description" rows={3} value={createForm.description} onChange={event => setCreateForm({ ...createForm, description: event.currentTarget.value })} />
      </label>
      <label>模板知识库
        <Select data-testid="create-kb-template" value={createForm.templateKbId} onChange={event => setCreateForm({ ...createForm, templateKbId: event.currentTarget.value })}>
          {kbs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </label>
      <div className="wd-knowledge-dialog-actions">
        <Button onClick={() => setCreateOpen(false)}>取消</Button>
        <Button variant="primary" data-testid="create-kb-submit" disabled={busy || !createForm.name.trim()} onClick={submitCreate}>创建</Button>
      </div>
    </Modal>

    <Modal open={confirm?.kind === 'delete-document'} label="删除文档" className="wd-knowledge-dialog" onClose={() => setConfirm(undefined)}>
      <h2>删除文档</h2>
      <p>将永久删除「{confirm?.kind === 'delete-document' ? confirm.document.title : ''}」及其分块与索引。删除异步执行且不可恢复。</p>
      <div className="wd-knowledge-dialog-actions">
        <Button onClick={() => setConfirm(undefined)}>取消</Button>
        <Button tone="danger" data-testid="confirm-delete-document" disabled={busy} onClick={submitDeleteDocument}>确认删除</Button>
      </div>
    </Modal>

    <Modal open={deletingKb !== undefined} label="删除知识库" className="wd-knowledge-dialog" onClose={() => { setConfirm(undefined); setKbDeleteName(''); }}>
      <h2>删除知识库</h2>
      <p>将永久删除知识库「{deletingKb?.name ?? ''}」及其索引，此操作不可恢复。</p>
      <label>输入知识库名称以确认
        <Input data-testid="delete-kb-name" value={kbDeleteName} placeholder={deletingKb?.name ?? ''} onChange={event => setKbDeleteName(event.currentTarget.value)} />
      </label>
      <div className="wd-knowledge-dialog-actions">
        <Button onClick={() => { setConfirm(undefined); setKbDeleteName(''); }}>取消</Button>
        <Button tone="danger" data-testid="confirm-delete-kb" disabled={busy || kbDeleteName.trim() !== (deletingKb?.name ?? '')} onClick={submitDeleteKb}>删除知识库</Button>
      </div>
    </Modal>
  </section>;
}
