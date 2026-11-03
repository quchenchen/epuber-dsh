import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSessionLog } from './session-log.mjs';
import { chromium, expect } from '@playwright/test';

/**
 * Acceptance for the agent side of the wiki channel.
 *
 * The reported experience was: search errors out, so the model reads documents
 * one by one and writes an analysis by hand. The fix is that a wiki-only base
 * answers `knowledge_search`, so this asserts the model actually searches —
 * and that what it gets back is a locator, not a fabricated chunk id.
 *
 * Usage:
 *   node scripts/verify-knowledge-wiki-agent.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-wiki-agent.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), '.epuberdsh/preview'), 'sessions');
await mkdir(shots, { recursive: true });

/** Unique per run: the preview build can post a new session's turn into an
 * existing session, so this token is how the run finds its own turn. */
const RUN = `run-${Date.now().toString(36)}`;
const PROMPT = `[${RUN}] 先用 knowledge_search 检索，再用一句话回答：新型电力系统是什么？必须给出 knowledge_id 或 wiki slug 作为出处。不要逐篇 knowledge_read 通读。`;
const report = { checks: [], shots: [] };
const check = (name, condition, detail = '') => {
  if (!condition) throw new Error(`FAILED: ${name}${detail ? ` (${detail})` : ''}`);
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const dismissSetup = async page => {
  for (const name of ['Continue', '继续']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
  for (const name of ['Configure later', '稍后配置']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
};
const recentSessionLogs = async since => {
  const found = [];
  for (const workspace of await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = join(sessionsRoot, workspace.name);
    for (const session of await readdir(workspaceDir, { withFileTypes: true }).catch(() => [])) {
      if (!session.isDirectory()) continue;
      const file = join(workspaceDir, session.name, 'session.v4.jsonl.zstd');
      const info = await stat(file).catch(() => undefined);
      if (!info || info.mtimeMs < since) continue;
      // Multi-frame zstd: the single-frame decoder would read only the header.
      const text = await readSessionLog(file).then(result => result.text).catch(() => undefined);
      if (!text) continue;
      found.push({ file, mtimeMs: info.mtimeMs, text });
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

const startedAt = Date.now() - 5_000;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await dismissSetup(page);

  const kbs = await page.evaluate(async () => {
    const response = await fetch('/api/epuberdsh-knowledge', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'list-kbs', payload: {} }),
    });
    const body = await response.json();
    return body.ok ? body.value : [];
  });
  const energy = kbs.find(kb => kb.name?.includes('能源知识库'));
  check('真实知识库可列举（Host 端点）', Boolean(energy), `got ${kbs.length}`);
  check('能源知识库被识别为仅 wiki 通道', energy?.capabilities?.wiki === true && !energy?.capabilities?.vector && !energy?.capabilities?.keyword,
    JSON.stringify(energy?.capabilities ?? {}));

  await page.getByText(/新会话|New Session/, { exact: true }).first().click({ timeout: 60_000 });
  const composer = page.locator('[contenteditable="true"][role="textbox"]').first();
  await expect(composer).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: '从知识库添加到对话' }).click();
  const dialog = page.getByRole('dialog', { name: '知识库' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: '引用 能源知识库' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  await composer.click();
  await composer.press('End');
  await composer.type(PROMPT);
  await expect(composer).toContainText(RUN, { timeout: 10_000 });
  await composer.press('Enter');
  // A dropped Enter leaves the text in place; nudge once instead of reporting a
  // missing turn later with no clue which step failed.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForTimeout(3_000);
    const draft = await composer.innerText().catch(() => '');
    if (!draft.includes(RUN)) break;
    await composer.press('Enter');
  }
  check('消息已发出（输入框已清空）', !(await composer.innerText().catch(() => '')).includes(RUN));
  check('页面无脚本错误', errors.length === 0, errors.join(' | '));

  // The preview build can post a new session's turn into an existing session,
  // and the log lands in batches, so poll widely and identify the turn by its
  // own event timestamps rather than by session identity.
  let logs = [];
  let bound;
  let events = [];
  for (let attempt = 1; attempt <= 46 && !bound; attempt += 1) {
    await page.waitForTimeout(attempt === 1 ? 15_000 : 10_000);
    logs = await recentSessionLogs(startedAt - 120_000);
    for (const log of logs) {
      if (!log.text.includes(RUN) || !log.text.includes('turn/end')) continue;
      bound = log;
      events = log.text.trim().split('\n').map(line => JSON.parse(line));
      break;
    }
  }
  check('本轮会话已落盘', Boolean(bound), `scanned ${logs.length} recent sessions`);
  const assistant = events.filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data?.message?.content ?? [])
    .filter(part => part.type === 'text').map(part => part.text).join('\n');
  const raw = bound.text;

  // The binding block rides in the runtime-context snapshot, not the system
  // message, so assert on the whole session rather than one event kind.
  check('对话注入块携带真实 kb_id', raw.includes('以下知识库已被用户显式加入') && raw.includes(energy.id), 'binding block missing');
  check('模型调用了 knowledge_search', raw.includes('knowledge_search'), 'no tool call in session');
  check('检索未返回接口错误', !raw.includes('无法识别的数据'), 'session contains 无法识别的数据');
  check('检索结果走 wiki 通道', /"via":"wiki"|wiki\\?"?:|wiki_slug/.test(raw), 'no wiki channel evidence');
  check('回答提到主题', /新型电力系统/.test(assistant), assistant.slice(0, 120));
  check('回答给出可核对的出处', new RegExp(`${energy.id}|(concept|entity|summary)/|knowledge_id`).test(assistant), assistant.slice(0, 160));

  await page.screenshot({ path: `${shots}24-agent-wiki-turn.png`, fullPage: true });
  report.shots.push(`${shots}24-agent-wiki-turn.png`);
  await writeFile(`${shots}knowledge-wiki-agent.json`, `${JSON.stringify({ ...report, kbId: energy.id, session: bound.file, assistant }, null, 2)}\n`);
  console.log(`AGENT WIKI OK · ${report.checks.length} checks · ${shots}knowledge-wiki-agent.json`);
  console.log(`--- assistant ---\n${assistant.slice(0, 600)}`);
} finally {
  await browser.close();
}
