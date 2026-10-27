import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WeKnoraClient, readPage } from '../dist/services/weknora-client.js';

/**
 * Live integration check against a running WeKnora deployment.
 *
 * The API key is read from WEKNORA_API_KEY, or — for local development only —
 * from /tmp/dsh-key-10000.txt. The script never prints the key.
 *
 *   WEKNORA_BASE_URL=http://127.0.0.1:18081 WEKNORA_API_KEY=... node tests/live-weknora.mjs
 */
const baseUrl = process.env.WEKNORA_BASE_URL ?? 'http://127.0.0.1:18081';
const apiKey = process.env.WEKNORA_API_KEY ?? await readFile('/tmp/dsh-key-10000.txt', 'utf8').catch(() => '');
if (!apiKey.trim()) throw new Error('Missing WEKNORA_API_KEY (or local /tmp/dsh-key-10000.txt).');
const client = new WeKnoraClient({ baseUrl, apiKey });

const kbs = (await client.getPage('/api/v1/knowledge-bases', { page: 1, page_size: 100 })).items;
assert.ok(kbs.length >= 2, `expected at least 2 knowledge bases, received ${kbs.length}`);
const energy = kbs.find(kb => String(kb.name).includes('能源知识库'));
const grid = kbs.find(kb => String(kb.name).includes('新型电力系统'));
assert.ok(grid, 'missing 新型电力系统 knowledge base');
console.log('KB list:', kbs.map(kb => `${kb.name}(${kb.id}, ${kb.knowledge_count} docs)`).join(' | '));
assert.equal(grid.knowledge_count, 7, '新型电力系统 should hold 7 documents');
if (energy) assert.equal(energy.knowledge_count, 1021, '能源知识库 should hold 1021 documents');

const docs = await client.getPage(`/api/v1/knowledge-bases/${grid.id}/knowledge`, { page: 1, page_size: 5 }, undefined, { page: 1, pageSize: 5 });
assert.equal(docs.items.length, 5);
assert.ok(docs.items.every(doc => typeof doc.parse_status === 'string'));
console.log('Documents:', docs.items.map(doc => `${doc.title} [${doc.parse_status}]`).join(' | '));
console.log('Document total:', docs.total);

const first = docs.items[0];
const detail = await client.getJson(`/api/v1/knowledge/${first.id}`);
assert.equal(detail.id, first.id);
console.log('Document detail:', detail.title, '· parse_status =', detail.parse_status, '· error_message =', JSON.stringify(detail.error_message ?? ''));

const preview = await client.getRaw(`/api/v1/knowledge/${first.id}/preview`, { range: 'bytes=0-1023', maxBytes: 1024 });
assert.equal(preview.status, 206);
assert.ok((preview.contentLength ?? 0) > 0);
console.log('Preview:', preview.contentType, '· total bytes =', preview.contentLength);

const chunks = await client.getPage(`/api/v1/chunks/${first.id}`, { page: 1, page_size: 3 }, undefined, { page: 1, pageSize: 3 });
assert.equal(chunks.items.length, 3);
assert.ok(chunks.items.every(chunk => typeof chunk.content === 'string' && chunk.content.length > 0));
console.log('Chunks:', chunks.items.map(chunk => `#${chunk.chunk_index}(${chunk.content.length} chars)`).join(' | '), '· total =', chunks.total);

const query = '新型电力系统 规划 目标';
for (const [mode, extra] of [['hybrid', {}], ['semantic', { disable_keywords_match: true }], ['keyword', { disable_vector_match: true }]]) {
  const page = readPage(await client.postJson(`/api/v1/knowledge-bases/${grid.id}/hybrid-search`, { query_text: query, match_count: 5, ...extra }));
  assert.ok(page.items.length >= 1, `${mode} search returned no hits`);
  assert.ok(page.items.every(hit => typeof hit.knowledge_title === 'string' && hit.knowledge_title.length > 0), `${mode} hits must carry knowledge_title`);
  assert.equal(typeof page.items[0].score, 'number');
  console.log(`${mode} search (${query}):`, page.items.map(hit => `${hit.knowledge_title} [${Number(hit.score).toFixed(3)}]`).join(' | '));
}

console.log('LIVE CHECK OK ·', baseUrl);
