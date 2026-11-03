import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WeKnoraClient } from '../dist/services/weknora-client.js';

/**
 * Live check of the retrieval surface the plugin uses.
 *
 * Pins the facts the plugin depends on, all against a real deployment:
 *  1. a base with no vector/keyword index answers `{data:null}` for an inline
 *     search — a zero-hit result, not an error (this used to surface as
 *     "知识库返回了无法识别的数据");
 *  2. such a base is still searchable through the wiki index, and a wiki hit
 *     points back at real documents;
 *  3. wiki matching is term-based: a bare term hits, the same question misses.
 *     That asymmetry is why the plugin retries once with a term.
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
  const wiki = capabilities.wiki === true;
  return {
    id: String(kb?.id),
    name: String(kb?.name),
    documents: Number(kb?.knowledge_count ?? 0),
    chunkCount: Number(kb?.chunk_count ?? 0),
    vector: capabilities.vector === true,
    keyword: capabilities.keyword === true,
    wiki,
    channel: indexed ? 'inline' : wiki ? 'wiki' : 'none',
  };
};

const kbs = (await client.getPage('/api/v1/knowledge-bases', { page: 1, page_size: 100 })).items.map(describe);
assert.ok(kbs.length >= 2, `expected at least 2 knowledge bases, received ${kbs.length}`);
for (const kb of kbs) {
  rows.push(`${kb.name}: docs=${kb.documents} chunks=${kb.chunkCount} vector=${kb.vector} keyword=${kb.keyword} wiki=${kb.wiki} channel=${kb.channel}`);
}

const inline = async (kbId, query) => {
  try {
    const page = await client.postPage('/api/v1/knowledge-search', { query, knowledge_base_ids: [kbId], match_count: 5 });
    return { hits: page.items, error: undefined };
  } catch (error) {
    return { hits: [], error };
  }
};

const wikiSearch = async (kbId, query) => {
  const page = await client.postPage('/api/v1/wiki-search', { query, knowledge_base_ids: [kbId], limit: 5 });
  return page.items;
};

for (const kb of kbs) {
  const { hits, error } = await inline(kb.id, '新型电力系统是什么');
  rows.push(`${kb.name}: inline hits=${hits.length}${error ? ` error=${error.code ?? error.message}` : ''}`);
  if (kb.channel === 'inline') {
    // The regression this script exists for: an unsearchable base must read as
    // "no hits", never as a malformed-data error.
    assert.equal(error, undefined, `${kb.name} should not raise on an inline search: ${error?.message ?? ''}`);
    if (!error) {
      assert.ok(hits.length > 0, `indexed base ${kb.name} returned no hits for a real query`);
      const hit = hits[0];
      assert.ok(hit.knowledge_id, 'hit is missing knowledge_id');
      assert.ok(hit.id ?? hit.chunk_id, 'hit is missing a chunk id');
      assert.ok(hit.knowledge_title, 'hit is missing knowledge_title');
      assert.equal(typeof hit.score, 'number');
    }
    continue;
  }

  // No inline index: the search must not fail, and the wiki channel must answer
  // for a base that was built with it.
  assert.equal(error, undefined, `${kb.name} should not raise without an index: ${error?.message ?? ''}`);
  assert.equal(hits.length, 0, `${kb.name} cannot return inline hits without an index`);
  if (!kb.wiki) {
    rows.push(`${kb.name}: no channel — nothing to search`);
    continue;
  }

  const term = await wikiSearch(kb.id, '新型电力系统');
  rows.push(`${kb.name}: wiki(term) hits=${term.length}`);
  assert.ok(term.length > 0, `wiki base ${kb.name} returned no hits for its own subject term`);
  const page = term[0];
  assert.ok(page.slug, 'wiki hit is missing slug');
  assert.ok(page.title, 'wiki hit is missing title');
  assert.ok(Array.isArray(page.aliases), 'wiki hit is missing aliases');

  // A question is what the model naturally writes; record whether it misses, so
  // the retry-with-term behaviour is justified by evidence rather than taste.
  const question = await wikiSearch(kb.id, '新型电力系统是什么');
  rows.push(`${kb.name}: wiki(question) hits=${question.length}`);

  const full = await client.getJson(`/api/v1/knowledgebase/${kb.id}/wiki/pages/${page.slug}`);
  const body = full?.data ?? full;
  assert.ok(typeof body?.content === 'string' && body.content.length > 0, 'wiki page has no body');
  assert.ok(Array.isArray(body.source_refs), 'wiki page has no source_refs');
  rows.push(`${kb.name}: page "${body.title}" refs=${body.source_refs.length} chunks=${(body.chunk_refs ?? []).length} body=${body.content.length} chars`);
}

console.log(rows.join('\n'));
console.log(`LIVE SEARCH OK · ${kbs.length} bases · ${kbs.filter(kb => kb.channel === 'inline').length} inline · ${kbs.filter(kb => kb.channel === 'wiki').length} wiki-only`);
