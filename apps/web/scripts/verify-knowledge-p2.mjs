import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * P2 GUI acceptance for the isolated knowledge-plugin profile: create KB, upload
 * a markdown document, watch the parse status settle, delete the document with
 * confirmation, then delete the KB (typed confirmation). Real KBs must survive.
 *
 * Usage:
 *   node scripts/verify-knowledge-p2.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-p2.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });
const KB_NAME = 'WorkDSH 插件联调';
const marker = `DSHKB-GUI-${Date.now()}`;
const uploadPath = '/tmp/knowledge-p2-upload.md';
await writeFile(uploadPath, `# WorkDSH 插件联调 GUI 样本文档\n\n联调标记 ${marker}。\n\n用于验证 GUI 的新建知识库、上传文档、解析状态轮询与删除确认流程。\n`);

const weknora = process.env.WEKNORA_BASE_URL ?? 'http://127.0.0.1:18081';
const apiKey = (process.env.WEKNORA_API_KEY ?? await readFile('/tmp/dsh-key-10000.txt', 'utf8').catch(() => '')).trim();
const api = async (method, path) => {
  if (!apiKey) return undefined;
  const response = await fetch(`${weknora}/api/v1${path}`, { method, headers: { 'X-API-Key': apiKey } });
  return response.ok ? response.json() : undefined;
};

const report = { checks: [], shots: [] };
const check = (name, condition) => {
  if (!condition) throw new Error(`FAILED: ${name}`);
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const shot = async (page, name) => {
  const path = `${shots}${name}`;
  await page.screenshot({ path, fullPage: true });
  report.shots.push(path);
  return path;
};
const dismissSetup = async page => {
  for (const name of ['Continue', '继续']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
  for (const name of ['Configure later', '稍后配置']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await dismissSetup(page);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await expect(page.getByTestId('create-kb-button')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('kb-card')).toHaveCount(2, { timeout: 30000 });
  check('知识库入口与真实 KB 列表可用', await page.getByTestId('kb-card').count() === 2);

  // 1) Create a dedicated test KB from the template KB.
  await page.getByTestId('create-kb-button').click();
  await expect(page.getByTestId('create-kb-name')).toBeVisible();
  await page.getByTestId('create-kb-name').fill(KB_NAME);
  await page.getByTestId('create-kb-description').fill('P2 GUI 验收专用测试知识库，验收后删除');
  await shot(page, 'p2-01-create-dialog.png');
  await page.getByTestId('create-kb-submit').click();
  await expect(page.getByTestId('kb-item').filter({ hasText: KB_NAME })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: KB_NAME, exact: true })).toBeVisible();
  check('新建知识库成功并进入知识库详情', true);
  await shot(page, 'p2-02-kb-created.png');

  // 2) Upload a markdown document; the row starts as pending/processing.
  await page.getByTestId('upload-input').setInputFiles(uploadPath);
  await expect(page.getByTestId('doc-item').first()).toBeVisible({ timeout: 30000 });
  await shot(page, 'p2-03-upload-processing.png');
  check('上传文档后文档列表出现新文档', (await page.getByTestId('doc-item').count()) === 1);

  // 3) Parsing is polled automatically until completed.
  await expect(page.getByTestId('parse-status-badge').last()).toHaveText('已解析', { timeout: 180000 });
  check('解析状态自动轮询到「已解析」', true);
  await shot(page, 'p2-04-parsed-documents.png');

  // 4) Document detail shows the parsed text and chunks.
  await page.getByTestId('doc-item').first().click();
  await expect(page.getByTestId('preview-text')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('chunk-item').first()).toBeVisible({ timeout: 30000 });
  const detail = await page.getByTestId('preview-text').textContent();
  check('文档详情显示解析文本与分块', (detail ?? '').includes('WorkDSH 插件联调 GUI 样本文档'));
  await shot(page, 'p2-05-document-detail.png');

  // 5) Reparse keeps the document usable and returns to completed.
  await page.getByTestId('reparse-document-button').click();
  await expect(page.getByTestId('processing-hint')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('processing-hint')).toHaveCount(0, { timeout: 180000 });
  await expect(page.getByTestId('parse-status-badge').first()).toHaveText('已解析', { timeout: 30000 });
  check('重新解析后自动轮询回到「已解析」', true);

  // 6) Delete the document behind a confirmation dialog.
  await page.getByTestId('delete-document-button').click();
  await expect(page.getByTestId('confirm-delete-document')).toBeVisible();
  await shot(page, 'p2-06-delete-confirm.png');
  await page.getByTestId('confirm-delete-document').click();
  await expect(page.getByTestId('doc-item')).toHaveCount(0, { timeout: 90000 });
  await page.waitForTimeout(2_500);
  await expect(page.getByTestId('doc-item')).toHaveCount(0);
  check('删除确认弹窗生效且文档从列表消失', true);
  await shot(page, 'p2-07-document-deleted.png');

  // 7) Delete the test KB with typed confirmation; real KBs must survive.
  await page.getByTestId('delete-kb-button').click();
  await expect(page.getByTestId('delete-kb-name')).toBeVisible();
  await page.getByTestId('delete-kb-name').fill(KB_NAME);
  await shot(page, 'p2-08-delete-kb-confirm.png');
  await page.getByTestId('confirm-delete-kb').click();
  await expect(page.getByTestId('kb-item').filter({ hasText: KB_NAME })).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId('kb-card')).toHaveCount(2, { timeout: 60000 });
  await shot(page, 'p2-09-kb-deleted.png');
  const names = await page.getByTestId('kb-item').allTextContents();
  check('测试知识库已删除且真实知识库仍在', !names.some(name => name.includes(KB_NAME)) && names.some(name => name.includes('能源知识库')) && names.some(name => name.includes('新型电力系统')));
  check('页面无未捕获异常', errors.length === 0);
  await writeFile(`${shots}p2-gui-check.json`, `${JSON.stringify({ origin: new URL(login).origin, marker, ...report }, null, 2)}\n`);
  console.log(`P2 GUI CHECK OK · ${report.checks.length} checks · ${shots}`);
} finally {
  await browser.close();
  // API fallback: never leave the dedicated test KB behind.
  try {
    const listed = await api('GET', '/knowledge-bases');
    const leftover = (listed?.data ?? []).filter(kb => kb.name === KB_NAME);
    for (const kb of leftover) {
      await api('DELETE', `/knowledge-bases/${kb.id}`);
      console.log('cleanup: removed leftover test KB', kb.id);
    }
    const after = await api('GET', '/knowledge-bases');
    const rows = (after?.data ?? []).map(kb => `${kb.name}(${kb.knowledge_count})`);
    if (rows.length) console.log('remaining KBs:', rows.join(', '));
    if (rows.length && (rows.length !== 2 || !rows.some(row => row.includes('能源知识库') && row.includes('1021')) || !rows.some(row => row.includes('新型电力系统') && row.includes('(7)')))) {
      console.error('WARNING: real KB state changed:', rows);
    }
  } catch (cause) { console.error('cleanup failed:', cause instanceof Error ? cause.message : cause); }
}
