import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * Acceptance for the retrieval surface after the zero-hit fix.
 *
 * Reproduces the reported failure: searching 能源知识库 (built without vector or
 * keyword indexing) must read as "no hits, and here is why", not as
 * "知识库返回了无法识别的数据"; a searchable base must still return cited hits.
 *
 * Usage:
 *   node scripts/verify-knowledge-search.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-search.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });

const QUERY = '新型电力系统是什么';
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
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await dismissSetup(page);

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await expect(page.getByTestId('kb-card')).toHaveCount(2, { timeout: 30_000 });

  // 1) The UI states the data fact up front instead of leaving it to a failed search.
  const unsearchable = page.getByTestId('kb-card').filter({ hasText: '能源知识库' }).getByTestId('kb-unsearchable');
  await expect(unsearchable).toBeVisible({ timeout: 20_000 });
  check('能源知识库卡片标注「不可检索」', (await unsearchable.innerText()).includes('不可检索'));
  await page.screenshot({ path: `${shots}12-kb-unsearchable.png` });
  report.shots.push(`${shots}12-kb-unsearchable.png`);

  // 2) Searching it is a zero-hit result with the real reason, not an error.
  await page.getByTestId('kb-card').filter({ hasText: '能源知识库' }).click();
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill(QUERY);
  await page.getByTestId('search-submit').click();
  const empty = page.getByTestId('search-empty');
  await expect(empty).toBeVisible({ timeout: 60_000 });
  const emptyText = await empty.innerText();
  check('零命中给出真实原因而非接口错误', emptyText.includes('未启用向量索引') || emptyText.includes('未启用向量索引与关键词索引'), emptyText.slice(0, 120));
  const errorToast = page.getByTestId('knowledge-error');
  check('不出现接口错误提示', await errorToast.count() === 0, (await errorToast.allInnerTexts()).join(' | '));
  await page.screenshot({ path: `${shots}13-search-unsearchable-empty.png` });
  report.shots.push(`${shots}13-search-unsearchable-empty.png`);

  // 3) A searchable base still returns cited hits through the same view.
  await page.getByTestId('nav-kbs').click();
  await page.getByTestId('kb-card').filter({ hasText: '新型电力系统' }).click();
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill(QUERY);
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-hit').first()).toBeVisible({ timeout: 60_000 });
  const hitCount = await page.getByTestId('search-hit').count();
  const scores = await page.getByTestId('hit-score').allInnerTexts();
  check('可检索知识库返回命中', hitCount > 0, `hits=${hitCount}`);
  check('命中带相关度分数', scores.length === hitCount && scores.every(text => /score\s[\d.]+/.test(text)), scores.slice(0, 3).join(' | '));
  check('页面无脚本错误', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${shots}14-search-hits.png`, fullPage: true });
  report.shots.push(`${shots}14-search-hits.png`);

  await writeFile(`${shots}knowledge-search.json`, `${JSON.stringify({ ...report, query: QUERY, emptyText, hitCount, scores }, null, 2)}\n`);
  await writeFile(`${shots}knowledge-search.txt`, `query=${QUERY}\nempty=${emptyText}\nhits=${hitCount}\n${scores.join('\n')}\n`);
  console.log(`SEARCH OK · ${report.checks.length} checks · hits=${hitCount}`);
} finally {
  await browser.close();
}
