import test from 'node:test';
import assert from 'node:assert/strict';
import { wikiLinksToText, wikiTermOf } from '../dist/services/knowledge-service.js';

/**
 * The wiki channel matches terms, not questions — that is WeKnora's ranking,
 * not our choice. These cases pin the one deterministic step the plugin takes:
 * strip a question down to its subject so a miss can be retried once, and stay
 * out of the way when the query is already a term.
 */
test('a trailing question word is stripped to its subject', () => {
  assert.equal(wikiTermOf('新型电力系统是什么'), '新型电力系统');
  assert.equal(wikiTermOf('宽频振荡怎么产生的'), '宽频振荡');
  assert.equal(wikiTermOf('储能有哪些'), '储能');
});

test('a noun suffix is stripped', () => {
  assert.equal(wikiTermOf('新型储能技术路线的定义'), '新型储能技术路线');
  assert.equal(wikiTermOf('十五五规划概述'), '十五五规划');
});

test('a space-separated question yields its first real term', () => {
  assert.equal(wikiTermOf('新型电力系统 定义'), '新型电力系统');
  assert.equal(wikiTermOf('请问 宽频振荡 的成因'), '宽频振荡');
});

test('a bare term needs no retry', () => {
  assert.equal(wikiTermOf('新型电力系统'), undefined);
  assert.equal(wikiTermOf('储能'), undefined);
});

test('a leading filler is dropped', () => {
  assert.equal(wikiTermOf('帮我查一下宽频振荡'), '宽频振荡');
  assert.equal(wikiTermOf('介绍一下新型电力系统'), '新型电力系统');
});

test('nothing usable yields no retry rather than a guess', () => {
  assert.equal(wikiTermOf('是什么'), undefined);
  assert.equal(wikiTermOf('   '), undefined);
  assert.equal(wikiTermOf('？'), undefined);
  assert.equal(wikiTermOf('a'), undefined);
});

test('wiki links are flattened to their label', () => {
  const source = '依据《[[entity/fa-gai-wei|发改委]]》，见[[concept/xin-xing-dian-li-xi-tong]]。';
  assert.equal(wikiLinksToText(source), '依据《发改委》，见xin-xing-dian-li-xi-tong。');
});

test('plain markdown passes through unchanged', () => {
  const source = '# 标题\n\n**一句话结论**：无链接。';
  assert.equal(wikiLinksToText(source), source);
});

test('search hits flatten the summary and the snippet they carry', async () => {
  const { KnowledgeService } = await import('../dist/services/knowledge-service.js');
  // `mapWikiHit` is TypeScript-private, which erases to a normal method, so the
  // mapping can be checked directly instead of through a fake HTTP round-trip.
  const hit = KnowledgeService.prototype.mapWikiHit.call({}, {
    id: 'page-1',
    slug: 'concept/x',
    title: '新型电力系统',
    knowledge_base_id: 'kb-1',
    summary: '参见[[concept/plan|行动方案]]。',
    match_snippet: '... # 加快构建[[concept/xin-xing-dian-li-xi-tong|新型电力系统]]行动[[concept/plan|方案]]',
  });
  assert.equal(hit.via, 'wiki');
  assert.equal(hit.wiki.summary, '参见行动方案。');
  assert.equal(hit.content, '... # 加快构建新型电力系统行动方案');
  assert.equal(hit.chunkId, '');
  assert.equal(hit.knowledgeId, '');
});
