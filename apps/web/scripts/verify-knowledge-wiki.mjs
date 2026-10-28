import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * Acceptance for the third retrieval channel: a base with no vector/keyword
 * index but with a wiki index is searchable, and the UI says so.
 *
 * Replaces the earlier script that asserted such a base was "不可检索" — that
 * claim was wrong (the bases here have thousands of wiki pages), and it is the
 * reason the model fell back to reading documents one by one.
 *
 * Covers:
 *  1. the knowledge entry no longer shares a glyph with 资料库;
 *  2. a wiki-only base is labelled 仅 wiki 检索, not 不可检索;
 *  3. a natural-language question still hits, because the Host retries the
 *     question's term against the wiki index;
 *  4. a wiki hit is presented as a locator (导览页 badge, no score) and its page
 *     body opens on demand.
 *
 * Usage:
 *   node scripts/verify-knowledge-wiki.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-wiki.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });

const QUESTION = '新型电力系统是什么';
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
/** The first path of a nav entry's glyph, so two entries can be compared by shape. */
const glyphOf = async locator => (await locator.locator('svg path').first().getAttribute('d')) ?? '';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await dismissSetup(page);

  // 1) Two entries, two shapes. Same glyph was the reported confusion.
  const knowledgeNav = page.getByRole('button', { name: '知识库', exact: true });
  const libraryNav = page.getByRole('button', { name: '资料库', exact: true });
  await expect(knowledgeNav).toBeVisible({ timeout: 30_000 });
  await expect(libraryNav).toBeVisible({ timeout: 30_000 });
  const knowledgeGlyph = await glyphOf(knowledgeNav);
  const libraryGlyph = await glyphOf(libraryNav);
  check('知识库与资料库图标不同', knowledgeGlyph.length > 0 && knowledgeGlyph !== libraryGlyph, `kb=${knowledgeGlyph.slice(0, 24)} lib=${libraryGlyph.slice(0, 24)}`);
  await page.screenshot({ path: `${shots}20-nav-icons.png` });
  report.shots.push(`${shots}20-nav-icons.png`);

  await knowledgeNav.click();
  await expect(page.getByTestId('kb-card')).toHaveCount(2, { timeout: 30_000 });

  // 2) The data fact is stated correctly: wiki-only, not unsearchable.
  const energyCard = page.getByTestId('kb-card').filter({ hasText: '能源知识库' });
  await expect(energyCard.getByTestId('kb-wiki-only')).toBeVisible({ timeout: 20_000 });
  check('能源知识库标注「仅 wiki 检索」而非「不可检索」',
    (await energyCard.getByTestId('kb-wiki-only').innerText()).includes('仅 wiki 检索')
    && await energyCard.getByTestId('kb-unsearchable').count() === 0);
  await page.screenshot({ path: `${shots}21-wiki-only-badge.png` });
  report.shots.push(`${shots}21-wiki-only-badge.png`);

  // 3) A question still hits: the Host retries its term against the wiki index.
  await energyCard.click();
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill(QUESTION);
  await page.getByTestId('search-submit').click();
  const firstHit = page.getByTestId('search-hit').first();
  await expect(firstHit).toBeVisible({ timeout: 90_000 });
  const hitCount = await page.getByTestId('search-hit').count();
  check('自然语言问句经 wiki 通道命中', hitCount > 0, `hits=${hitCount}`);
  const body = (await page.locator('.wd-knowledge-hits').innerText()).slice(0, 400);
  check('命中是真实政策/概念页而非空结果', /新型电力系统|电力/.test(body), body.replace(/\n/g, ' ').slice(0, 120));
  check('不出现接口错误提示', await page.getByTestId('knowledge-error').count() === 0);
  await page.screenshot({ path: `${shots}22-wiki-hits.png`, fullPage: true });
  report.shots.push(`${shots}22-wiki-hits.png`);

  // 4) A wiki hit is a locator, not a quote: badge instead of score, and the
  //    page body is fetched on demand.
  const wikiBadge = firstHit.getByTestId('hit-wiki');
  await expect(wikiBadge).toBeVisible({ timeout: 10_000 });
  check('wiki 命中标注「wiki 导览页」', (await wikiBadge.innerText()).includes('wiki'));
  const scoreCount = await firstHit.getByTestId('hit-score').count();
  check('wiki 命中不显示相关度分数', scoreCount === 0, `score nodes=${scoreCount}`);

  await firstHit.getByTestId('hit-wiki-open').click();
  const wikiBody = firstHit.getByTestId('hit-wiki-body');
  await expect(wikiBody).toBeVisible({ timeout: 60_000 });
  const pageText = await wikiBody.innerText();
  check('可展开读取 wiki 页正文', pageText.length > 200, `${pageText.length} chars`);
  check('正文来自真实 wiki 页', /新型电力系统|电力系统/.test(pageText), pageText.replace(/\n/g, ' ').slice(0, 120));
  await page.screenshot({ path: `${shots}23-wiki-page-body.png`, fullPage: true });
  report.shots.push(`${shots}23-wiki-page-body.png`);

  check('页面无脚本错误', errors.length === 0, errors.join(' | '));

  await writeFile(`${shots}knowledge-wiki.json`, `${JSON.stringify({
    ...report,
    question: QUESTION,
    hitCount,
    wikiBodyChars: pageText.length,
    glyphs: { knowledge: knowledgeGlyph, library: libraryGlyph },
  }, null, 2)}\n`);
  console.log(`WIKI CHANNEL OK · ${report.checks.length} checks · ${shots}knowledge-wiki.json`);
} finally {
  await browser.close();
}
