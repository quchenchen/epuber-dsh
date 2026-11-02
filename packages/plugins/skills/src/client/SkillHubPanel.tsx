import * as React from 'react';
import { useEffect, useState } from 'react';
import { Button, Input, Modal } from 'epuberdsh-ui';
import type { SkillHubCard, SkillHubDetail, SkillHubSettingsView } from '../skillhub-contract.js';
import type { SkillHubClient } from './skillhub.js';

const PAGE_SIZE = 24;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : '技能中心暂不可用，请稍后重试。';
/** The failure code is the only thing a member can forward to an administrator, so keep it visible. */
const codeOf = (cause: unknown): string => {
  const code = (cause as { code?: unknown })?.code;
  return typeof code === 'string' && code.startsWith('skillhub/') ? code : '';
};

function hostOf(registryUrl: string): string {
  try { return new URL(registryUrl).host; } catch { return registryUrl; }
}

function SkillHubMark({ card }: { card: SkillHubCard }) {
  return <span className="skillhub-icon" aria-hidden="true">{card.name.slice(0, 1).toUpperCase()}</span>;
}

/** A registry address a member cannot type is a deployment decision, so the setup card only appears when none is saved. */
function SetupCard({ client, settings, onSaved }: { client: SkillHubClient; settings?: SkillHubSettingsView; onSaved: (next: SkillHubSettingsView) => void }) {
  const [registryUrl, setRegistryUrl] = useState(settings?.registryUrl ?? '');
  const [token, setToken] = useState('');
  const [namespace, setNamespace] = useState(settings?.namespace ?? 'epuberdsh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');

  const save = async () => {
    setBusy(true); setError(''); setErrorCode('');
    try {
      onSaved(await client.configure({ registryUrl, namespace, ...(token.trim() ? { token } : {}) }));
      setToken('');
    } catch (cause) { setError(messageOf(cause)); setErrorCode(codeOf(cause)); }
    finally { setBusy(false); }
  };

  return <section className="skillhub-config" aria-label="连接技能中心">
    <h2>{settings?.configured ? '修改技能中心连接' : '连接企业技能中心'}</h2>
    <p className="muted">技能中心负责技能的版本、上架审核与授权。这里只保存服务地址与令牌变量；令牌写入本机凭据存储，不进入任何项目文件。</p>
    <label className="skillhub-field"><span>服务地址</span>
      <Input value={registryUrl} placeholder="https://skillhub.example.com" spellCheck={false} onChange={event => setRegistryUrl(event.currentTarget.value)} />
    </label>
    <label className="skillhub-field"><span>默认命名空间</span>
      <Input value={namespace} placeholder="epuberdsh" spellCheck={false} onChange={event => setNamespace(event.currentTarget.value)} />
    </label>
    <label className="skillhub-field"><span>访问令牌{settings?.credentialConfigured ? '（已保存，留空则保持不变）' : ''}</span>
      <Input type="password" value={token} placeholder={settings?.credentialConfigured ? '已保存' : '在技能中心「个人设置 → 访问令牌」创建'} spellCheck={false} autoComplete="off" onChange={event => setToken(event.currentTarget.value)} />
    </label>
    {error && <p className="error" role="alert">{error}{errorCode && <small className="error-code">{errorCode}</small>}</p>}
    <div className="skillhub-config-actions">
      <Button variant="primary" disabled={busy || !registryUrl.trim()} onClick={() => void save()}>{busy ? '正在保存…' : '保存并连接'}</Button>
      {settings?.configured && <Button disabled={busy} onClick={() => setRegistryUrl('')}>取消</Button>}
      <span className="muted">令牌变量名：<code>{settings?.credentialRef ?? 'SKILLHUB_TOKEN'}</code></span>
    </div>
  </section>;
}

/** Reads the internal SkillHub registry and installs through the Host's verified import path. */
export function SkillHubPanel({ client, query, onInstalled, onOpenInstalled }: {
  client: SkillHubClient; query: string; onInstalled: () => Promise<void>; onOpenInstalled: () => void;
}) {
  const [settings, setSettings] = useState<SkillHubSettingsView>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cards, setCards] = useState<readonly SkillHubCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [installing, setInstalling] = useState('');
  const [installedName, setInstalledName] = useState('');
  const [detail, setDetail] = useState<SkillHubDetail>();
  const [detailBusy, setDetailBusy] = useState('');
  /** Default to the member's own namespace: the registry's public examples must not bury their team's skills. */
  const [scope, setScope] = useState<'own' | 'all'>('own');

  const showError = (cause: unknown): void => { setError(messageOf(cause)); setErrorCode(codeOf(cause)); };

  useEffect(() => {
    let live = true;
    void client.status()
      .then(next => { if (live) setSettings(next); })
      .catch(cause => { if (live) showError(cause); });
    return () => { live = false; };
  }, [client]);

  useEffect(() => { setPage(0); }, [query, settings?.registryUrl, scope]);

  useEffect(() => {
    if (!settings?.configured) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true); setError('');
      const namespace = scope === 'all' ? '' : settings.namespace;
      void client.search({ query: query.trim() || undefined, namespace, page, pageSize: PAGE_SIZE }, controller.signal)
        .then(result => { setCards(result.items); setTotal(result.total); })
        .catch(cause => { if (!controller.signal.aborted && (cause as { code?: string })?.code !== 'skillhub/cancelled') showError(cause); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [client, query, page, scope, settings?.configured, settings?.registryUrl, settings?.namespace]);

  const install = async (card: SkillHubCard, version?: string) => {
    setInstalling(card.slug); setError('');
    try {
      const result = await client.install({ namespace: card.namespace, slug: card.slug, ...(version ? { version } : {}) });
      setCards(current => current.map(item => item.slug === card.slug ? { ...item, installed: true } : item));
      setInstalledName(result.name);
      await onInstalled();
    } catch (cause) { showError(cause); }
    finally { setInstalling(''); }
  };

  const openDetail = async (card: SkillHubCard) => {
    setDetailBusy(card.slug); setError('');
    try { setDetail(await client.detail({ namespace: card.namespace, slug: card.slug })); }
    catch (cause) { showError(cause); }
    finally { setDetailBusy(''); }
  };

  if (!settings) return <p className="muted" role="status">{error || '正在读取技能中心连接…'}</p>;
  if (!settings.configured || settingsOpen) {
    return <SetupCard client={client} settings={settings} onSaved={next => { setSettings(next); setSettingsOpen(false); }} />;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstPage = Math.max(0, Math.min(page - 2, pageCount - 5));
  const pageNumbers = Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPage + index);

  return <section className="skillhub-market" aria-label="企业技能中心">
    <div className="market-head">
      <h2>技能中心 {!error && <span className="market-count">{total}</span>}</h2>
      <span className="muted">来源：{hostOf(settings.registryUrl)}{settings.credentialConfigured ? '' : ' · 未配置令牌，仅能浏览公开技能'}{settings.persisted ? '' : ' · 连接仅本次会话有效'}</span>
      <Button className="refresh" onClick={() => setSettingsOpen(true)}>连接设置</Button>
    </div>
    {installedName && <div className="skillhub-success" role="status"><span>已安装「{installedName}」。</span><Button onClick={onOpenInstalled}>查看已安装</Button><button className="skillhub-dismiss" aria-label="关闭安装提示" onClick={() => setInstalledName('')}>×</button></div>}
    <nav className="skillhub-scope" aria-label="技能所属命名空间">
      <button className={scope === 'own' ? 'active' : ''} aria-current={scope === 'own' ? 'page' : undefined} onClick={() => setScope('own')}>{settings.namespace}</button>
      <button className={scope === 'all' ? 'active' : ''} aria-current={scope === 'all' ? 'page' : undefined} onClick={() => setScope('all')}>全部命名空间</button>
      <span className="muted">{scope === 'own' ? '本部门发布的技能' : '包含技能中心自带的公开示例技能'}</span>
    </nav>
    {error && <div className="catalog-note" role="alert"><span>{error}{errorCode && <small className="error-code">{errorCode}</small>}</span><Button onClick={onOpenInstalled}>查看已安装技能</Button></div>}
    {busy ? <p className="muted" role="status">正在读取技能中心…</p> : cards.length ? <div className="grid">{cards.map(card =>
      <article className="card market-card" key={`${card.namespace}/${card.slug}`}>
        <div className="card-top">
          <button className="card-open" aria-label={`查看技能 ${card.name}`} onClick={() => void openDetail(card)}>
            <SkillHubMark card={card} />
            <span className="card-title"><strong title={card.name}>{card.name}</strong><small>{card.labels?.slice(0, 2).join(' · ') || card.owner || card.slug}</small></span>
          </button>
          <Button className={`install${card.installed || installing === card.slug ? ' is-status' : ''}${card.installed ? ' is-installed' : ''}`}
            disabled={card.installed || Boolean(installing)} aria-label={card.installed ? `已安装 ${card.name}` : `安装 ${card.name}`}
            onClick={() => void install(card)}>{card.installed ? '已安装' : installing === card.slug ? '安装中…' : '＋'}</Button>
        </div>
        <p className="muted">{card.description}</p>
        <small className="skillhub-meta">版本 {card.version || '未标注'} · {card.namespace}/{card.slug}{detailBusy === card.slug ? ' · 读取详情…' : ''}</small>
      </article>)}</div> : !error && <p className="muted">{query.trim() ? '没有找到匹配的技能。' : '技能中心还没有可用技能。'}</p>}
    {!busy && pageCount > 1 && <nav className="skillhub-pagination" aria-label="技能中心分页"><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>{firstPage > 0 && <span aria-hidden="true">…</span>}{pageNumbers.map(number => <button key={number} aria-current={page === number ? 'page' : undefined} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number + 1}</button>)}{firstPage + pageNumbers.length < pageCount && <span aria-hidden="true">…</span>}<Button disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>下一页</Button><span className="muted">第 {page + 1} / {pageCount} 页</span></nav>}

    <Modal open={Boolean(detail)} label={detail ? `${detail.name} 技能详情` : '技能详情'} className="skill-detail-dialog" onClose={() => setDetail(undefined)}>
      {detail && <article data-testid="skillhub-detail">
        <div className="detail-hero"><SkillHubMark card={detail} /><div className="detail-title"><h1>{detail.name}</h1><p className="slug">{detail.namespace}/{detail.slug}</p>
          <div className="detail-actions">
            <Button variant="primary" className="install solid" disabled={detail.installed || Boolean(installing)} onClick={() => void install(detail)}>{detail.installed ? '已安装' : installing === detail.slug ? '正在安装…' : '＋ 安装最新版'}</Button>
            <Button onClick={() => setDetail(undefined)}>关闭</Button>
          </div></div></div>
        <p className="detail-summary">{detail.description}</p>
        <div className="detail-body"><dl><dt>所属命名空间</dt><dd>{detail.namespace}</dd><dt>负责人</dt><dd>{detail.owner ?? '未标注'}</dd><dt>最新版本</dt><dd>{detail.version ?? '未标注'}</dd><dt>下载次数</dt><dd>{detail.downloads ?? 0}</dd></dl></div>
        <h2 className="detail-section-title">版本</h2>
        {detail.versions.length ? <div className="resource-list">{detail.versions.map(entry => <Button key={entry.version} disabled={Boolean(installing)} onClick={() => void install(detail, entry.version)}>安装 {entry.version}</Button>)}</div> : <p className="muted">没有可列出的历史版本。</p>}
      </article>}
    </Modal>
  </section>;
}
