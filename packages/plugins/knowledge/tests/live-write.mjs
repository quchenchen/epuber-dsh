import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WeKnoraClient, readPage } from '../dist/services/weknora-client.js';

/**
 * Live write-path acceptance against a running WeKnora deployment.
 *
 * Creates the dedicated test knowledge base 「WorkDSH 插件联调」, uploads a
 * markdown document, waits for parsing, searches its unique marker, reparses,
 * deletes the document and finally deletes the test KB. Real knowledge bases
 * (能源知识库 / 新型电力系统) are only read as the config template.
 *
 *   WEKNORA_BASE_URL=http://127.0.0.1:18081 WEKNORA_API_KEY=... node tests/live-write.mjs
 */
const baseUrl = process.env.WEKNORA_BASE_URL ?? 'http://127.0.0.1:18081';
const apiKey = process.env.WEKNORA_API_KEY ?? await readFile('/tmp/dsh-key-10000.txt', 'utf8').catch(() => '');
if (!apiKey.trim()) throw new Error('Missing WEKNORA_API_KEY (or local /tmp/dsh-key-10000.txt).');
const client = new WeKnoraClient({ baseUrl, apiKey });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const marker = `DSHKB-WRITE-${Date.now()}`;
const kBName = 'WorkDSH 插件联调';

const listKbs = async () => (await client.getPage('/api/v1/knowledge-bases', { page: 1, page_size: 100 })).items;
const listDocs = async kbId => client.getPage(`/api/v1/knowledge-bases/${kbId}/knowledge`, { page: 1, page_size: 100 });
const status = async knowledgeId => String((await client.getJson(`/api/v1/knowledge/${knowledgeId}`)).parse_status);
const waitStatus = async (knowledgeId, target, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await status(knowledgeId);
    if (current === target) return current;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${target}; last status = ${current}`);
    await sleep(3_000);
  }
};
const waitGone = async (lookup, predicate, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await lookup()).some(predicate)) return true;
    if (Date.now() > deadline) return false;
    await sleep(2_000);
  }
};

const before = await listKbs();
const energy = before.find(kb => kb.name.includes('能源知识库'));
const grid = before.find(kb => kb.name.includes('新型电力系统'));
assert.ok(grid, 'missing 新型电力系统 template KB');
const started = Date.now();
let kbId;
try {
  console.log(`[1] template KB: ${grid.name} (${grid.id})`);
  const template = await client.getJson(`/api/v1/knowledge-bases/${grid.id}`);
  assert.ok(template.embedding_model_id, 'template KB has no embedding model');
  const created = await client.postJson('/api/v1/knowledge-bases', {
    name: kBName,
    description: 'P2 验收专用测试知识库，验收结束后自动删除',
    embedding_model_id: template.embedding_model_id,
    chunking_config: {
      chunk_size: 1024,
      chunk_overlap: 80,
      separators: ['\n\n', '\n', '。', '！', '？', '；'],
    },
    indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: false, graph_enabled: false },
    question_generation_config: { enabled: false, question_count: 1 },
  });
  kbId = created.data.id;
  console.log(`[2] created test KB ${kbId} (${Date.now() - started}ms)`);

  const markdown = `# WorkDSH 插件联调样本文档\n\n联调标记 ${marker}。\n\n本文件用于验证 WorkDSH 知识库插件的上传、解析状态轮询、混合检索、重新解析与删除流程。验收完成后删除。\n`;
  const form = new FormData();
  form.append('file', new Blob([new TextEncoder().encode(markdown)], { type: 'text/markdown' }), 'WorkDSH 插件联调样本文档.md');
  form.append('fileName', 'WorkDSH 插件联调样本文档.md');
  const uploaded = await client.postMultipart(`/api/v1/knowledge-bases/${kbId}/knowledge/file`, form);
  assert.equal(uploaded.title, 'WorkDSH 插件联调样本文档.md');
  console.log(`[3] uploaded ${uploaded.id} parse_status=${uploaded.parse_status} (${Date.now() - started}ms)`);

  await waitStatus(uploaded.id, 'completed');
  console.log(`[4] parsing completed (${Date.now() - started}ms)`);

  const hits = readPage(await client.postJson(`/api/v1/knowledge-bases/${kbId}/hybrid-search`, { query_text: marker, match_count: 5 })).items;
  assert.ok(hits.length >= 1, 'hybrid search did not find the uploaded marker');
  assert.equal(hits[0].knowledge_title, 'WorkDSH 插件联调样本文档.md');
  console.log(`[5] hybrid search hit: ${hits[0].knowledge_title} score=${Number(hits[0].score).toFixed(3)}`);

  const reparsed = await client.postJson(`/api/v1/knowledge/${uploaded.id}/reparse`, {});
  assert.equal((reparsed.data ?? reparsed).id, uploaded.id);
  await waitStatus(uploaded.id, 'completed');
  console.log(`[6] reparse completed (${Date.now() - started}ms)`);

  await client.deleteJson(`/api/v1/knowledge/${uploaded.id}`);
  const docGone = await waitGone(async () => (await listDocs(kbId)).items, document => document.id === uploaded.id);
  assert.ok(docGone, 'document did not disappear after delete');
  console.log(`[7] document deleted (${Date.now() - started}ms)`);

  await client.deleteJson(`/api/v1/knowledge-bases/${kbId}`);
  const kbGone = await waitGone(listKbs, kb => kb.id === kbId);
  assert.ok(kbGone, 'test KB did not disappear after delete');
  const after = await listKbs();
  assert.ok(!after.some(kb => kb.name === kBName), 'test KB still listed');
  assert.equal(after.length, before.length, 'unexpected KB count change');
  if (energy) assert.ok(after.some(kb => kb.id === energy.id && kb.knowledge_count === energy.knowledge_count), '能源知识库 changed');
  assert.ok(after.some(kb => kb.id === grid.id && kb.knowledge_count === grid.knowledge_count), '新型电力系统 changed');
  console.log(`[8] test KB deleted; real KBs intact: ${after.map(kb => `${kb.name}(${kb.knowledge_count})`).join(', ')} (${Date.now() - started}ms)`);
  console.log(`LIVE WRITE CHECK OK · ${baseUrl} · ${marker}`);
} finally {
  // Never leave the dedicated test KB behind, even after a failed assertion.
  try {
    const existing = (await listKbs()).find(kb => kb.name === kBName || kb.id === kbId);
    if (existing) {
      const docs = await listDocs(existing.id).catch(() => ({ items: [] }));
      for (const document of docs.items) await client.deleteJson(`/api/v1/knowledge/${document.id}`).catch(() => undefined);
      await sleep(2_000);
      await client.deleteJson(`/api/v1/knowledge-bases/${existing.id}`).catch(() => undefined);
      console.log('cleanup: removed leftover test KB', existing.id);
    }
  } catch (cause) { console.error('cleanup failed:', cause instanceof Error ? cause.message : cause); }
}
