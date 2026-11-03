import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * UI + Host-binding acceptance for `@知识库` conversation references.
 *
 * Scope: the composer entry, the `@` menu group, the inserted chip, and the
 * Session binding actually written through the Host RPC (read back, not assumed).
 * The prompt-injection half is covered deterministically by
 * `packages/plugins/knowledge/tests/selection.test.mjs` (assemble hook) and was
 * verified end to end against a real Session log (see
 * `.artifacts/knowledge-plugin/knowledge-reference.json`): the model quoted the
 * `kb_id` it was never given in the message.
 *
 * Usage:
 *   node scripts/verify-knowledge-reference.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-reference.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });

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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  const errors = [];
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().includes('/api/epuberdsh-knowledge')) return;
    const body = (() => { try { return JSON.parse(request.postData() ?? '{}'); } catch { return {}; } })();
    if (body.endpoint === 'set-selection') writes.push(body.payload ?? {});
  });
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
  console.log(`  能源知识库 kb_id=${energy.id} documents=${energy.knowledgeCount}`);

  await page.getByText(/新会话|New Session/, { exact: true }).first().click({ timeout: 60_000 });
  const composer = page.locator('[contenteditable="true"][role="textbox"]').first();
  await expect(composer).toBeVisible({ timeout: 60_000 });

  await composer.click();
  await composer.type('@');
  await expect(page.getByText(/知识库 · \d+ 篇文档/).first()).toBeVisible({ timeout: 20_000 });
  check('@ 菜单出现知识库候选组', (await page.locator('body').innerText()).includes('知识库 ·'));
  await page.screenshot({ path: `${shots}09-knowledge-at-menu.png` });
  report.shots.push(`${shots}09-knowledge-at-menu.png`);
  await composer.press('Escape');

  await page.getByRole('button', { name: '从知识库添加到对话' }).click();
  const dialog = page.getByRole('dialog', { name: '知识库' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText('能源知识库')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: '引用 能源知识库' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  const draft = await composer.innerText();
  check('引用后输入框出现知识库 chip', draft.includes('能源知识库'), draft.replace(/\n/g, '⏎').slice(0, 80));
  await page.screenshot({ path: `${shots}10-knowledge-chip.png` });
  report.shots.push(`${shots}10-knowledge-chip.png`);

  // The binding must be written for the Session the composer belongs to...
  await expect.poll(() => writes.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const write = writes.at(-1);
  check('引用写入 Session 绑定（Host RPC）', (write.knowledgeBases ?? []).some(row => row.id === energy.id), JSON.stringify(write).slice(0, 160));

  // ...and read back through the same endpoint the prompt builder uses.
  const persisted = await page.evaluate(async sessionId => {
    const response = await fetch('/api/epuberdsh-knowledge', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'selection', payload: { sessionId } }),
    });
    const body = await response.json();
    return body.ok ? body.value : { error: body.error };
  }, write.sessionId);
  check('绑定可从 Host 读回', Array.isArray(persisted) && persisted.some(row => row.id === energy.id), JSON.stringify(persisted).slice(0, 160));
  check('页面无脚本错误', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${shots}11-knowledge-binding.png`, fullPage: true });
  report.shots.push(`${shots}11-knowledge-binding.png`);

  await writeFile(`${shots}knowledge-reference.json`, `${JSON.stringify({ ...report, kbId: energy.id, sessionId: write.sessionId, binding: persisted }, null, 2)}\n`);
  console.log(`REFERENCE OK · ${report.checks.length} checks · session=${write.sessionId}`);
} finally {
  await browser.close();
}
