import test from 'node:test';
import assert from 'node:assert/strict';
import { registerKnowledgeTools } from '../dist/tools/knowledge-tools.js';

/**
 * The tool layer's contract in front of the model: a zero-hit search must come
 * back as an explained result — never as a thrown error the model retries four
 * times in different modes (the reported failure mode).
 */
const register = searchDetailed => {
  const tools = new Map();
  const ctx = {
    tools: { register: definition => { tools.set(definition.name, definition); } },
    workdshIdentity: { resolve: async () => ({ principalId: 'p', organizationId: 'o', requestId: 'r', resolvedBy: 'test' }) },
    workdshKnowledge: { searchDetailed },
  };
  registerKnowledgeTools(ctx);
  return tools;
};
const exec = { signal: new AbortController().signal, agent: { id: 'session-1' } };

test('an unsearchable base explains itself instead of raising', async () => {
  const calls = [];
  const tools = register(async (_actor, input) => {
    calls.push(input);
    return {
      hits: [],
      scope: [{ id: 'kb-1', name: '能源知识库', chunkCount: 0, searchable: false, reason: '该知识库创建时未启用向量索引与关键词索引（仅 wiki）' }],
    };
  });
  const value = await tools.get('knowledge_search').execute({ query: '新型电力系统是什么', knowledge_base_ids: ['kb-1'], limit: 10 }, exec);
  assert.equal(value.count, 0);
  assert.deepEqual(value.searched_knowledge_bases, [{
    knowledge_base_id: 'kb-1', name: '能源知识库', chunk_count: 0, searchable: false,
    reason: '该知识库创建时未启用向量索引与关键词索引（仅 wiki）',
  }]);
  assert.match(value.note, /没有任何可检索的知识库/);
  assert.match(value.note, /未启用向量索引/);
  assert.deepEqual(calls[0].kbIds, ['kb-1']);
  assert.equal(calls[0].matchCount, 10);
});

test('a searchable base with no match advises a different query, not a retry loop', async () => {
  const tools = register(async () => ({
    hits: [],
    scope: [{ id: 'kb-2', name: '新型电力系统', chunkCount: 0, searchable: true }],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '不相干的问题', kb_id: 'kb-2' }, exec);
  assert.equal(value.count, 0);
  assert.match(value.note, /可检索但本次未命中/);
});

test('hits carry citations and leave no note', async () => {
  const tools = register(async () => ({
    hits: [{
      chunkId: 'chunk-1', knowledgeId: 'doc-1', knowledgeTitle: '规划.pdf', knowledgeBaseId: 'kb-2',
      score: 1.048, content: '加快构建新型电力系统'.repeat(3), chunkIndex: 0,
    }],
    scope: [],
  }));
  const value = await tools.get('knowledge_search').execute({ query: '新型电力系统' }, exec);
  assert.equal(value.count, 1);
  assert.equal(value.hits[0].chunk_id, 'chunk-1');
  assert.equal(value.hits[0].knowledge_id, 'doc-1');
  assert.equal(value.note, undefined);
});
