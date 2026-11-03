import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * Agent-tool acceptance for the isolated knowledge-plugin profile: ask a real
 * session to call `knowledge_search` and display the citation fields.
 *
 * Usage:
 *   node scripts/verify-knowledge-tool.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-tool.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });
const KB_ID = '9e3e6426-57a2-4006-9465-b66a9087d54e';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  for (const name of ['Continue', '继续']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
  for (const name of ['Configure later', '稍后配置']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);

  const prompt = `请调用一次 knowledge_search 工具，参数：query="${'新型电力系统 规划 目标'}"，kb_id="${KB_ID}"，match_count=3，mode=hybrid。然后原样列出工具返回结果中每条命中项的 knowledge_title 和 chunk_id，并说明这些命中是否带出了处（knowledge_title / knowledge_id / chunk_id）。不要使用其他工具，不要编造内容。`;
  const sendTurn = async () => {
    await page.goto(login, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.getByText(/新会话|New Session/, { exact: true }).first().click({ timeout: 60_000 });
    const composer = page.locator('[contenteditable="true"][role="textbox"]').first();
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(prompt);
    await composer.press('Enter');
    await page.waitForFunction(() => /已完成，用时|Completed in|执行失败|出错|错误/.test(document.body.innerText), undefined, { timeout: 180_000 });
    const text = await page.locator('body').innerText();
    if (!/已完成，用时|Completed in/.test(text)) throw new Error(`agent turn did not complete: ${text.slice(-400).replace(/\n+/g, ' | ')}`);
    return text;
  };
  let transcript;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try { transcript = await sendTurn(); break; }
    catch (cause) {
      console.error(`attempt ${attempt} failed: ${cause instanceof Error ? cause.message.slice(0, 300) : cause}`);
      if (attempt === 2) throw cause;
      await page.waitForTimeout(5_000);
    }
  }
  const citations = transcript.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  const checks = {
    invokedTool: /knowledge_search/.test(transcript),
    realKnowledgeTitle: /新型电力系统建设/.test(transcript),
    chunkCitations: /chunk_id/i.test(transcript) && citations.length > 0,
    knowledgeIdCitations: /knowledge_id/i.test(transcript) && citations.length > 1,
    noPageErrors: errors.length === 0,
  };
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed) throw new Error(`FAILED: ${name}`);
    console.log(`PASS ${name}`);
  }
  await page.screenshot({ path: `${shots}08-agent-tool-search.png`, fullPage: true });
  await writeFile(`${shots}agent-tool-search.txt`, transcript);
  await writeFile(`${shots}agent-tool-search.json`, `${JSON.stringify({ checks, citations: [...new Set(citations)], screenshot: `${shots}08-agent-tool-search.png` }, null, 2)}\n`);
  console.log(`TOOL CHECK OK · ${Object.keys(checks).length} checks · ${shots}08-agent-tool-search.png`);
} finally {
  await browser.close();
}
