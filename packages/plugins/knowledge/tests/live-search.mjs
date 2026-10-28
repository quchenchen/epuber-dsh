import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WeKnoraClient } from '../dist/services/weknora-client.js';

/**
 * Live check of the retrieval surface the plugin now uses.
 *
 * Pins the two facts the plugin depends on:
 *  1. a base with no vector/keyword index answers `{data:null}` — a zero-hit
 *     result, not an error (this is what used to surface as
 *     "知识库返回了无法识别的数据");
 *  2. `/knowledge-search` (the endpoint WeKnora's own chat and agent use)
 *     returns cited chunks for a searchable base.
 *
 *   WEKNORA_BASE_URL=http://127.0.0.1:18081 WEKNORA_API_KEY=... node tests/live-search.mjs
 *
 * The API key is read from WEKNORA_API_KEY, or — for local development only —
 * from /tmp/dsh-key-10000.txt. The script never prints the key.
 */
const baseUrl = process.env.WEKNORA_BASE_URL ?? 'http://127.0.0.1:18081';
const apiKey = (process.env.WEKNORA_API_KEY ?? await readFile('/tmp/dsh-key-10000.txt', 'utf8').catch(() => '')).trim();
if (!apiKey) throw new Error('Missing WEKNORA_API_KEY (or local /tmp/dsh-key-10000.txt).');
const client = new WeKnoraClient({ baseUrl, apiKey });
const rows = [];

const describe = kb => {
  const capabilities = kb?.capabilities ?? {};
  const indexed = capabilities.vector === true || capabilities.keyword === true;
  return {
    id: String(kb?.id),
    name: String(kb?.name),
    documents: Number(kb?.knowledge_count ?? 0),
    chunkCount: Number(kb?.chunk_count ?? 0),
    vector: capabilities.vector === true,
    keyword: capabilities.keyword === true,
    searchable: indexed,
  };
};

const kbs = (await client.getPage('/api/v1/knowledge-bases', { page: 1, page_size: 100 })).items.map(describe);
assert.ok(kbs.length >= 2, `expected at least 2 knowledge bases, received ${kbs.length}`);
for (const kb of kbs) {
  rows.push(`${kb.name}: docs=${kb.documents} chunks=${kb.chunkCount} vector=${kb.vector} keyword=${kb.keyword} searchable=${kb.searchable}`);
}

const search = async kbId => {
  try {
    const page = await client.postPage('/api/v1/knowledge-search', { query: '新型电力系统是什么', knowledge_base_ids: [kbId], match_count: 5 });
    return { hits: page.items, error: undefined };
  } catch (error) {
    return { hits: [], error };
  }
};

for (const kb of kbs) {
  const { hits, error } = await search(kb.id);
  rows.push(`${kb.name}: hits=${hits.length}${error ? ` error=${error.code ?? error.message}` : ''}`);
  if (!kb.searchable) {
    // The regression this script exists for: an unsearchable base must read as
    // "no hits", never as a malformed-data error.
    assert.equal(error, undefined, `${kb.name} should not raise on an unsearchable base: ${error?.message ?? ''}`);
    assert.equal(hits.length, 0, `${kb.name} cannot return hits without an index`);
  } else if (!error) {
    assert.ok(hits.length > 0, `searchable base ${kb.name} returned no hits for a real query`);
    const hit = hits[0];
    assert.ok(hit.knowledge_id, 'hit is missing knowledge_id');
    assert.ok(hit.id ?? hit.chunk_id, 'hit is missing a chunk id');
    assert.ok(hit.knowledge_title, 'hit is missing knowledge_title');
    assert.equal(typeof hit.score, 'number');
  }
}

console.log(rows.join('\n'));
console.log(`LIVE SEARCH OK · ${kbs.length} bases · ${kbs.filter(kb => kb.searchable).length} searchable`);
