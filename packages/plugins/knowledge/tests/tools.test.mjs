import test from 'node:test';
import assert from 'node:assert/strict';
import { registerKnowledgeTools } from '../dist/tools/knowledge-tools.js';

/**
 * The tool layer's contract in front of the model: a zero-hit search must come
 * back as an explained result — never as a thrown error the model retries four
 * times in different modes (the reported failure mode). A wiki-only base is
 * searchable, so its advice must differ from a genuinely unsearchable one.
 */
const register = (searchDetailed, extra = {}) => {
  const tools = new Map();
  const ctx = {
    tools: { register: definition => { tools.set(definition.name, definition); } },
    epuberdshIdentity: { resolve: async () => ({ principalId: 'p', organizationId: 'o', requestId: 'r', resolvedBy: 'test' }) },
    epuberdshKnowledge: { searchDetailed, ...extra },
  };
  registerKnowledgeTools(ctx);
  return tools;
};
const exec = { signal: new AbortController().signal, agent: { id: 'session-1' } };

test('a base with no channel at all explains itself instead of raising', async () => {
  const calls = [];
  const tools = register(async (_actor, input) => {
    calls.push(input);
    return {
      hits: [],
      scope: [{
        id: 'kb-1', name: '能源知识库', chunkCount: 0, searchable: false, channels: [],
        reason: '该知识库既未启用向量/关键词索引，也未启用 wiki',
      }],
    };
  });
  const value = await tools.get('knowledge_search').execute({ query: '新型电力系统是什么', knowledge_base_ids: ['kb-1'], limit: 10 }, exec);
  assert.equal(value.count, 0);
  assert.deepEqual(value.searched_knowledge_bases, [{
    knowledge_base_id: 'kb-1', name: '能源知识库', chunk_count: 0, searchable: false, channels: [],
    reason: '该知识库既未启用向量/关键词索引，也未启用 wiki',
  }]);
  assert.match(value.note, /没有可用检索通道/);
  assert.match(value.note, /未启用向量\/关键词索引/);
  assert.deepEqual(calls[0].kbIds, ['kb-1']);
  assert.equal(calls[0].matchCount, 10);
});

test('a wiki-only miss tells the caller to use a term, not to retry the question', async () => {
  const tools = register(async () => ({
    hits: [],
    scope: [{ id: 'kb-1', name: '能源知识库', chunkCount: 0, searchable: true, channels: ['wiki'] }],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '新型电力系统是什么', kb_id: 'kb-1' }, exec);
  assert.equal(value.count, 0);
  assert.match(value.note, /只有 wiki 索引/);
  assert.match(value.note, /自然语言问句通常失配/);
  assert.match(value.note, /knowledge_read/);
});

test('a wiki-only miss that already retried a term names the term', async () => {
  const tools = register(async () => ({
    hits: [],
    scope: [{ id: 'kb-1', name: '能源知识库', chunkCount: 0, searchable: true, channels: ['wiki'] }],
    wikiTerm: '不存在的术语',
  }));
  const value = await tools.get('knowledge_search').execute({ query: '不存在的术语是什么', kb_id: 'kb-1' }, exec);
  assert.equal(value.wiki_term, '不存在的术语');
  assert.match(value.note, /已改用「不存在的术语」重试仍未命中/);
});

test('an indexed base with no match advises a different query, not a retry loop', async () => {
  const tools = register(async () => ({
    hits: [],
    scope: [{ id: 'kb-2', name: '新型电力系统', chunkCount: 0, searchable: true, channels: ['inline', 'wiki'] }],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '不相干的问题', kb_id: 'kb-2' }, exec);
  assert.equal(value.count, 0);
  assert.match(value.note, /走索引检索但未命中/);
  assert.doesNotMatch(value.note, /只有 wiki 索引/);
});

test('a mixed scope explains both channels in one note', async () => {
  const tools = register(async () => ({
    hits: [],
    scope: [
      { id: 'kb-2', name: '新型电力系统', chunkCount: 7, searchable: true, channels: ['inline'] },
      { id: 'kb-1', name: '能源知识库', chunkCount: 0, searchable: true, channels: ['wiki'] },
    ],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '不相干的问题', knowledge_base_ids: ['kb-2', 'kb-1'] }, exec);
  assert.match(value.note, /1 个知识库走索引检索但未命中/);
  assert.match(value.note, /另有 1 个库只有 wiki 索引/);
});

test('inline hits carry citations and leave no note', async () => {
  const tools = register(async () => ({
    hits: [{
      chunkId: 'chunk-1', knowledgeId: 'doc-1', knowledgeTitle: '规划.pdf', knowledgeBaseId: 'kb-2',
      score: 1.048, content: '加快构建新型电力系统'.repeat(3), chunkIndex: 0, via: 'inline',
    }],
    scope: [],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '新型电力系统' }, exec);
  assert.equal(value.count, 1);
  assert.equal(value.hits[0].via, 'inline');
  assert.equal(value.hits[0].chunk_id, 'chunk-1');
  assert.equal(value.hits[0].knowledge_id, 'doc-1');
  assert.equal(value.note, undefined);
});

test('a wiki hit is reported as a locator, never as a quotable chunk', async () => {
  const tools = register(async () => ({
    hits: [{
      chunkId: '', knowledgeId: '', knowledgeTitle: '新型电力系统', knowledgeBaseId: 'kb-1',
      score: 0, content: '定义与特征：适应高比例新能源接入…', via: 'wiki',
      wiki: {
        pageId: 'page-1', slug: 'concept/xin-xing-dian-li-xi-tong', pageType: 'concept',
        summary: '适应高比例新能源接入的现代化电力系统形态。',
        aliases: ['以新能源为主体的新型电力系统'],
        sourceKnowledgeIds: ['doc-a', 'doc-b'], chunkRefCount: 142,
      },
    }],
    scope: [{ id: 'kb-1', name: '能源知识库', chunkCount: 0, searchable: true, channels: ['wiki'] }],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '新型电力系统', kb_id: 'kb-1' }, exec);
  assert.equal(value.count, 1);
  const hit = value.hits[0];
  assert.equal(hit.via, 'wiki');
  assert.equal(hit.chunk_id, '');
  assert.equal(hit.knowledge_id, '');
  assert.equal(hit.wiki_slug, 'concept/xin-xing-dian-li-xi-tong');
  assert.equal(hit.chunk_ref_count, 142);
  assert.deepEqual(hit.source_knowledge_ids, ['doc-a', 'doc-b']);
  // The renderer must not promise ids the search endpoint never returns.
  assert.match(tools.get('knowledge_search').output.render({}, value)[0].text, /返回会列出可读的来源文档/);
  // The rendered text must say the page is derived: that sentence is what stops
  // the model from quoting a summary page as source prose.
  const rendered = tools.get('knowledge_search').output.render({}, value)[0].text;
  assert.match(rendered, /wiki 导览页/);
  assert.match(rendered, /导览页是派生摘要，不是原文/);
  assert.match(rendered, /knowledge_read_wiki/);
});

test('the wiki reader surfaces the page body plus its source documents', async () => {
  const tools = register(async () => ({ hits: [], scope: [] }), {
    readWikiPage: async () => ({
      pageId: 'page-1', slug: 'concept/x', pageType: 'concept', summary: 's',
      aliases: [], sourceKnowledgeIds: ['doc-a', 'doc-b'], chunkRefCount: 142,
      knowledgeBaseId: 'kb-1', title: '新型电力系统', content: '# 新型电力系统\n\n定义…', text: '# 新型电力系统\n\n定义…',
    }),
  });
  const value = await tools.get('knowledge_read_wiki').execute({ kb_id: 'kb-1', slug: 'concept/x' }, exec);
  assert.equal(value.title, '新型电力系统');
  assert.equal(value.is_derived, true);
  assert.equal(value.truncated, false);
  assert.deepEqual(value.source_knowledge_ids, ['doc-a', 'doc-b']);
  const rendered = tools.get('knowledge_read_wiki').output.render({}, value)[0].text;
  assert.match(rendered, /知识库|派生页/);
  assert.match(rendered, /逐字引用须用 knowledge_read/);
});

test('the wiki reader pages long bodies by offset', async () => {
  const tools = register(async () => ({ hits: [], scope: [] }), {
    readWikiPage: async () => ({
      pageId: 'p', slug: 'concept/x', pageType: 'concept', summary: '',
      aliases: [], sourceKnowledgeIds: [], chunkRefCount: 0,
      knowledgeBaseId: 'kb-1', title: 't', content: 'x'.repeat(100), text: 'x'.repeat(100),
    }),
  });
  const value = await tools.get('knowledge_read_wiki').execute({ kb_id: 'kb-1', slug: 'concept/x', limit: 30 }, exec);
  assert.equal(value.content.length, 30);
  assert.equal(value.truncated, true);
  assert.equal(value.next_offset, 30);
});
