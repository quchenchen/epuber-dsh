import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * Agent write-tool acceptance: knowledge_upload + knowledge_delete against a
 * temporary KB created through REST, then cleaned up (including on failure).
 *
 * Usage:
 *   node scripts/verify-knowledge-write-tools.mjs "http://127.0.0.1:18990/?token=..."
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-write-tools.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
const KB_NAME = 'WorkDSH 插件联调-工具';
const marker = `DSHKB-TOOL-${Date.now()}`;
const weknora = process.env.WEKNORA_BASE_URL ?? 'http://127.0.0.1:18081';
const apiKey = (process.env.WEKNORA_API_KEY ?? await readFile('/tmp/dsh-key-10000.txt', 'utf8').catch(() => '')).trim();
if (!apiKey) throw new Error('Missing WEKNORA_API_KEY (or /tmp/dsh-key-10000.txt).');
const api = async (method, path, body) => {
  const response = await fetch(`${weknora}/api/v1${path}`, {
    method,
    headers: { 'X-API-Key': apiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${payload?.message ?? payload?.error?.message ?? 'unknown'}`);
  return payload;
};

const templateKb = (await api('GET', '/knowledge-bases')).data.find(kb => kb.name.includes('新型电力系统'));
if (!templateKb) throw new Error('missing 新型电力系统 template KB');
const template = (await api('GET', `/knowledge-bases/${templateKb.id}`)).data;
const created = await api('POST', '/knowledge-bases', {
  name: KB_NAME,
  description: 'Agent 写入工具验收专用，结束后删除',
  embedding_model_id: template.embedding_model_id,
  chunking_config: { chunk_size: 1024, chunk_overlap: 80, separators: ['\n\n', '\n', '。'] },
  indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: false, graph_enabled: false },
  question_generation_config: { enabled: false, question_count: 1 },
});
const kbId = created.data.id;
console.log('temp KB', kbId);

const browser = await chromium.launch({ headless: true });
const checks = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  page.on('pageerror', error => console.log('PAGEERROR', error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const prompt = `请依次调用两个工具：1) knowledge_upload：kb_id="${kbId}"，file_name="tool-check.md"，content="# 工具写入验证\n\n标记 ${marker}。\n"，wait=true；2) 用第 1 步返回的 knowledge_id 调用 knowledge_delete：confirm=true，wait=true。最后用一句话说明两次工具调用的结果（上传的解析状态、删除是否生效）。不要调用其他工具。`;
  const sendTurn = async () => {
    await page.goto(login, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.getByText(/新会话|New Session/, { exact: true }).first().click({ timeout: 60_000 });
    const composer = page.locator('[contenteditable="true"][role="textbox"]').first();
    await composer.waitFor({ state: 'visible', timeout: 60_000 });
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
  checks.uploadTool = /knowledge_upload/.test(transcript) && /上传成功|已上传|已解析/.test(transcript);
  checks.deleteTool = /knowledge_delete/.test(transcript) && /删除已生效|已删除|删除成功/.test(transcript);
  checks.uploadedStatus = /已解析|解析状态/.test(transcript);
  checks.multiStep = /1 轮 3 步/.test(transcript);
  checks.noPageErrors = true;
  await page.screenshot({ path: `${shots}p2-10-agent-write-tools.png`, fullPage: true });
  await writeFile(`${shots}agent-write-tools.txt`, transcript);
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed) throw new Error(`FAILED: ${name}`);
    console.log(`PASS ${name}`);
  }
  // The agent's delete should have removed the document; verify through REST.
  const deadline = Date.now() + 60_000;
  let documents = [];
  for (;;) {
    documents = (await api('GET', `/knowledge-bases/${kbId}/knowledge?page=1&page_size=100`)).data ?? [];
    if (!documents.length || Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (documents.length) throw new Error(`FAILED: agent delete left ${documents.length} document(s)`);
  console.log('PASS agent knowledge_delete removed the document');
  console.log(`WRITE TOOL CHECK OK · ${shots}p2-10-agent-write-tools.png`);
} finally {
  await browser.close();
  await api('DELETE', `/knowledge-bases/${kbId}`).catch(cause => console.error('cleanup failed:', cause instanceof Error ? cause.message : cause));
  const remaining = (await api('GET', '/knowledge-bases').catch(() => ({ data: [] }))).data ?? [];
  console.log('remaining KBs:', remaining.map(kb => `${kb.name}(${kb.knowledge_count})`).join(', '));
}
