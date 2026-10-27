import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * GUI acceptance for the isolated knowledge-plugin profile.
 *
 * Usage:
 *   node scripts/verify-knowledge-isolated.mjs "http://127.0.0.1:18990/?token=..."
 *
 * Requires a running DSH Web profile that has workdsh-plugin-knowledge
 * installed (see packages/plugins/knowledge/README.md). Real WeKnora data is
 * expected: two knowledge bases (能源知识库 / 新型电力系统) reachable through the
 * Host. Screenshots land in .artifacts/knowledge-plugin/.
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-isolated.mjs <login-url-with-token>');
const origin = new URL(login).origin;
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });

const dismissSetup = async (page) => {
  for (const name of ['Continue', '继续']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
  for (const name of ['Configure later', '稍后配置']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
};

const browser = await chromium.launch({ headless: true });
const report = { shots: [], checks: [] };
const check = (name, condition) => {
  if (!condition) throw new Error(`FAILED: ${name}`);
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await dismissSetup(page);

  const nav = page.getByRole('button', { name: '知识库', exact: true });
  await expect(nav).toBeVisible({ timeout: 60000 });
  check('一级导航出现「知识库」', await nav.count() === 1);
  await page.screenshot({ path: `${shots}01-navigation.png` });
  report.shots.push(`${shots}01-navigation.png`);

  await nav.click();
  await expect(page.getByTestId('kb-card')).toHaveCount(2, { timeout: 30000 });
  const kbNames = await page.getByTestId('kb-item').allTextContents();
  check('知识库列表列出 2 个真实知识库', kbNames.length === 2 && kbNames.some(name => name.includes('新型电力系统')) && kbNames.some(name => name.includes('能源知识库')));
  await page.screenshot({ path: `${shots}02-knowledge-bases.png` });
  report.shots.push(`${shots}02-knowledge-bases.png`);

  await page.getByTestId('kb-card').filter({ hasText: '新型电力系统' }).click();
  await expect(page.getByTestId('doc-item').first()).toBeVisible({ timeout: 30000 });
  const docCount = await page.getByTestId('doc-item').count();
  check('文档列表可见（新型电力系统 KB）', docCount >= 5);
  await expect(page.getByTestId('parse-status-badge').first()).toBeVisible();
  const badges = await page.getByTestId('parse-status-badge').allTextContents();
  check('文档带解析状态徽标', badges.length === docCount && badges.every(text => text.trim().length > 0));
  await page.screenshot({ path: `${shots}03-documents.png` });
  report.shots.push(`${shots}03-documents.png`);

  await page.getByTestId('doc-item').first().click();
  await expect(page.getByTestId('preview-text')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('chunk-item').first()).toBeVisible({ timeout: 30000 });
  const previewText = await page.getByTestId('preview-text').textContent();
  check('文档详情展示预览文本', (previewText ?? '').trim().length > 40);
  const chunkCount = await page.getByTestId('chunk-item').count();
  check('文档详情展示分块列表', chunkCount > 0);
  await page.screenshot({ path: `${shots}04-document-detail.png` });
  report.shots.push(`${shots}04-document-detail.png`);

  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill('新型电力系统 规划 目标');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-hit').first()).toBeVisible({ timeout: 30000 });
  const hitCount = await page.getByTestId('search-hit').count();
  const firstHit = await page.getByTestId('search-hit').first().textContent();
  check('混合检索返回带 knowledge_title 的段落', hitCount > 0 && (firstHit ?? '').includes('新型电力系统') && (firstHit ?? '').includes('score'));
  await expect(page.getByTestId('hit-score').first()).toContainText(/score \d\.\d{3}/);
  await page.screenshot({ path: `${shots}05-hybrid-search.png` });
  report.shots.push(`${shots}05-hybrid-search.png`);

  for (const [value, label] of [['semantic', '语义'], ['keyword', '关键词']]) {
    await page.getByTestId('search-mode').selectOption(value);
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-hit').first()).toBeVisible({ timeout: 30000 });
    check(`${label}检索返回结果`, await page.getByTestId('search-hit').count() > 0);
  }
  await page.screenshot({ path: `${shots}06-keyword-search.png` });
  report.shots.push(`${shots}06-keyword-search.png`);

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-base-url')).toBeVisible();
  const baseUrl = await page.getByTestId('settings-base-url').inputValue();
  check('设置面板显示真实连接地址', baseUrl.includes('127.0.0.1:18081'));
  await page.screenshot({ path: `${shots}07-settings.png` });
  report.shots.push(`${shots}07-settings.png`);

  check('页面无未捕获异常', errors.length === 0);
  if (errors.length) console.error(errors);
  await writeFile(`${shots}gui-check.json`, `${JSON.stringify({ origin, ...report }, null, 2)}\n`);
  console.log(`GUI CHECK OK · ${report.checks.length} checks · screenshots in ${shots}`);
} finally {
  await browser.close();
}
