import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SESSION_KNOWLEDGE_BASES,
  normalizeKnowledgeSelection,
} from '../dist/services/knowledge-service.js';
import { buildKnowledgeSelectionContext, registerKnowledgeContextInjection } from '../dist/runtime/context-injection.js';
import { knowledgeSelectionKey, knowledgeSelectionSchema } from '../dist/storage/domain.js';

/** Minimal Context stand-in: one handler table, the three services the hook touches. */
const fakeContext = ({ selection = async () => [], identity, warn } = {}) => {
  const handlers = new Map();
  const warnings = [];
  const ctx = {
    on: (event, handler) => { handlers.set(event, handler); },
    workdshIdentity: { resolve: identity ?? (async () => ({ principalId: 'p', organizationId: 'o', requestId: 'r', resolvedBy: 'test' })) },
    workdshKnowledge: { sessionSelection: selection },
    logger: () => ({ warn: message => { warnings.push(message); warn?.(message); } }),
  };
  registerKnowledgeContextInjection(ctx);
  return { ctx, warnings, assemble: (assembly, context, next) => handlers.get('system-prompt/assemble')(assembly, context, next) };
};

const agent = { id: 'session-1' };
const passthrough = async () => ({ sections: [], contexts: [], tools: [], variables: {} });

const kb = (id, name, documentCount) => ({ id, name, ...(documentCount === undefined ? {} : { documentCount }) });

test('normalize trims ids and keeps the first occurrence of a base', () => {
  const rows = normalizeKnowledgeSelection([kb(' kb-1 ', '能源知识库', 1021), kb('kb-1', '重复')]);
  assert.deepEqual(rows, [{ id: 'kb-1', name: '能源知识库', documentCount: 1021 }]);
});

test('normalize falls back to the resolved name, then the raw id', () => {
  const rows = normalizeKnowledgeSelection([kb('kb-1'), kb('kb-2')], new Map([['kb-1', '能源知识库']]));
  assert.deepEqual(rows, [{ id: 'kb-1', name: '能源知识库' }, { id: 'kb-2', name: 'kb-2' }]);
});

test('normalize rejects an empty or control-character id', () => {
  assert.throws(() => normalizeKnowledgeSelection([kb('  ')]), /知识库 ID 无效/);
  assert.throws(() => normalizeKnowledgeSelection([kb('a\u0000b')]), /知识库 ID 无效/);
});

test(`normalize caps one conversation at ${MAX_SESSION_KNOWLEDGE_BASES} bases`, () => {
  const many = Array.from({ length: MAX_SESSION_KNOWLEDGE_BASES + 1 }, (_, index) => kb(`kb-${index}`, `库 ${index}`));
  assert.equal(normalizeKnowledgeSelection(many.slice(0, MAX_SESSION_KNOWLEDGE_BASES)).length, MAX_SESSION_KNOWLEDGE_BASES);
  assert.throws(() => normalizeKnowledgeSelection(many), /最多引用/);
});

test('selection key isolates members and sessions', () => {
  const base = knowledgeSelectionKey('org', 'principal', 'session-1');
  assert.notEqual(base, knowledgeSelectionKey('org', 'principal', 'session-2'));
  assert.notEqual(base, knowledgeSelectionKey('org', 'other-principal', 'session-1'));
  assert.equal(base, knowledgeSelectionKey('org', 'principal', 'session-1'));
  assert.ok(base.length <= 240);
});

test('selection record round-trips through its schema', () => {
  const state = {
    schemaVersion: 1,
    owner: { organizationId: 'org', principalId: 'principal' },
    sessionId: 'session-1',
    knowledgeBases: [{ id: 'kb-1', name: '能源知识库', documentCount: 1021 }],
    updatedAt: new Date('2026-10-28T00:00:00.000Z').toISOString(),
  };
  assert.deepEqual(knowledgeSelectionSchema.parse(state), state);
});

test('no binding renders no prompt context', () => {
  assert.equal(buildKnowledgeSelectionContext([]), undefined);
});

test('prompt context names every base with its id and binds retrieval to it', () => {
  const text = buildKnowledgeSelectionContext([
    { id: 'kb-1', name: '能源知识库', documentCount: 1021 },
    { id: 'kb-2', name: '新型电力系统' },
  ]);
  assert.ok(text.includes('<knowledge-base name="能源知识库" kb_id="kb-1" documents="1021" />'));
  assert.ok(text.includes('<knowledge-base name="新型电力系统" kb_id="kb-2" />'));
  assert.ok(text.includes('必须先调用 knowledge_search'));
  assert.ok(text.includes('knowledge_title、knowledge_id、chunk_id'));
  assert.ok(text.includes('@知识库/'));
  // The block must never smuggle knowledge text into the prompt.
  assert.ok(!text.includes('<library-document'));
});

test('assemble hook injects the block for the Session it reads', async () => {
  const seen = [];
  const { assemble } = fakeContext({ selection: async (actor, sessionId) => { seen.push(sessionId); return [{ id: 'kb-1', name: '能源知识库', documentCount: 1021 }]; } });
  const assembly = await assemble({ sections: [], contexts: [], tools: [], variables: {} }, { agent, signal: new AbortController().signal }, passthrough);
  assert.deepEqual(seen, ['session-1']);
  const block = assembly.contexts.find(row => row.name === 'workdsh:knowledge-selection');
  assert.ok(block, 'missing workdsh:knowledge-selection context');
  assert.ok(block.text.includes('kb_id="kb-1"'));
});

test('assemble hook stays silent without a selection', async () => {
  const { assemble } = fakeContext({ selection: async () => [] });
  const assembly = await assemble({ sections: [], contexts: [], tools: [], variables: {} }, { agent }, passthrough);
  assert.equal(assembly.contexts.length, 0);
});

test('assemble hook skips assemblies with no agent', async () => {
  let called = false;
  const { assemble } = fakeContext({ selection: async () => { called = true; return []; } });
  await assemble({ sections: [], contexts: [], tools: [], variables: {} }, {}, passthrough);
  assert.equal(called, false);
});

test('a failing selection read never blocks the turn', async () => {
  const { assemble, warnings } = fakeContext({ selection: async () => { throw new Error('storage offline'); } });
  const assembly = await assemble({ sections: [], contexts: [], tools: [], variables: {} }, { agent }, passthrough);
  assert.equal(assembly.contexts.length, 0);
  assert.match(warnings.join('\n'), /storage offline/);
});
