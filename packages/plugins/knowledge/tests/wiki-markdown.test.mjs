import test from 'node:test';
import assert from 'node:assert/strict';
import { wikiLinksToMarkdown, wikiSlugFromHref, wikiSlugLabel } from '../dist/client/wiki-markdown.js';

/**
 * Wiki bodies are stored with `[[slug|label]]` links. The official markdown
 * renderer only knows GFM, so anything left in that dialect shows up verbatim
 * as double brackets. These cases pin the rewrite: links survive as real links,
 * their destinations stay addressable, and nothing else in the document moves.
 */

test('a labelled wiki link becomes a markdown link carrying the slug', () => {
  assert.equal(
    wikiLinksToMarkdown('详见 [[entity/zhongwen-chuanmei|中文传媒]] 的披露。'),
    '详见 [中文传媒](wiki:entity/zhongwen-chuanmei) 的披露。',
  );
});

test('a bare wiki link falls back to the slug tail as its label', () => {
  assert.equal(wikiLinksToMarkdown('[[concept/ip]]'), '[ip](wiki:concept/ip)');
  assert.equal(wikiSlugLabel('summary/16961398-862f-4eb4'), '16961398-862f-4eb4');
});

test('links inside headings and list items are rewritten in place', () => {
  const source = [
    '## [[entity/zhongwen-chuanmei|中文传媒]] 2025 年半年度报告',
    '',
    '- 二十一世纪出版社“[[entity/dazhonghua-xunbaoji|大中华寻宝记]]”IP 多业态协同。',
  ].join('\n');
  const result = wikiLinksToMarkdown(source);
  assert.match(result, /^## \[中文传媒\]\(wiki:entity\/zhongwen-chuanmei\)/m);
  assert.match(result, /\[大中华寻宝记\]\(wiki:entity\/dazhonghua-xunbaoji\)/);
});

test('several links on one line all rewrite', () => {
  const result = wikiLinksToMarkdown('[[a/x|甲]] 与 [[b/y|乙]]');
  assert.equal(result, '[甲](wiki:a/x) 与 [乙](wiki:b/y)');
});

test('ordinary markdown and already-plain text are untouched', () => {
  const source = '# 标题\n\n**加粗** 与 [外链](https://example.com) 以及 `code`。\n';
  assert.equal(wikiLinksToMarkdown(source), source);
});

test('a bracket inside a label is not a wiki link, and stays literal', () => {
  // WeKnora's own parser stops at the first `]`; rewriting half of this would
  // emit a link plus a stray bracket, so the whole match is rejected.
  const source = '[[entity/x|甲[乙]]]';
  assert.equal(wikiLinksToMarkdown(source), source);
});

test('the destination round-trips back to a slug', () => {
  const href = '[甲](wiki:concept/ip)'.match(/\((wiki:[^)]+)\)/)?.[1];
  assert.equal(wikiSlugFromHref(href), 'concept/ip');
  assert.equal(wikiSlugFromHref('https://example.com'), undefined);
  assert.equal(wikiSlugFromHref(undefined), undefined);
});
