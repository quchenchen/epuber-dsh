import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeService } from '../dist/services/knowledge-service.js';
import { knowledgeStateKey, knowledgeStateSchema, knowledgeStateStoredSchema } from '../dist/storage/domain.js';

const { settings, updateSettings } = KnowledgeService.prototype;

const actor = (principalId = 'alice') => ({
  organizationId: 'org-1',
  principalId,
  requestId: `req-${principalId}`,
  resolvedBy: 'test',
});

/**
 * A KnowledgeService with only what the settings paths touch. The instance
 * inherits the real prototype so private helpers (`ensureState`, `key`,
 * `settingsView`) run as written; only storage and services are stubbed.
 */
const service = (options = {}) => {
  const { stored, baseUrl, roles = {} } = options;
  // `role: undefined` must stay undefined (an identity that cannot answer), so
  // the default is applied only when the caller says nothing at all.
  const resolveRole = principalId => (principalId in roles
    ? roles[principalId]
    : ('role' in options ? options.role : 'owner'));
  const state = new Map(stored ? Object.entries(stored) : []);
  const writes = [];
  const credentials = {
    writes: [],
    describe: async () => ({ configured: true, source: 'env' }),
    set: async (ref, value) => { credentials.writes.push([ref, value]); },
  };
  const self = Object.create(KnowledgeService.prototype);
  self.options = baseUrl === undefined ? {} : { baseUrl };
  self.table = {
    get: key => state.get(key),
    put: async (key, value) => { writes.push(key); state.set(key, value); },
    delete: async key => { state.delete(key); },
  };
  self.selectionTable = { get: () => undefined, put: async () => {}, delete: async () => {} };
  self.ctx = {
    credentials,
    epuberdshIdentity: {
      membership: (organizationId, principalId) => {
        const role = resolveRole(principalId);
        return role === undefined ? undefined : {
          organizationId, principalId, principalKind: 'human', role, state: 'active', revision: 'r1',
        };
      },
    },
  };
  return { self, state, writes, credentials };
};

test('settings key carries the organization only, so members share one row', () => {
  assert.equal(knowledgeStateKey('org-1'), 'org_org-1');
  assert.notEqual(knowledgeStateKey('org-1'), knowledgeStateKey('org-2'));
  // No principal component anywhere: two members of one org must collide.
  assert.ok(!knowledgeStateKey('org-1').includes('alice'));
});

test('a reading member never pins the composed defaults', async () => {
  const { self, writes } = service({ baseUrl: 'http://kb.internal:18081' });
  const view = await settings.call(self, actor('mallory'));
  assert.equal(view.baseUrl, 'http://kb.internal:18081');
  assert.equal(view.scope, 'organization');
  assert.equal(writes.length, 0, 'a read must not write a row that would freeze the default');
});

test('an administrator writes once and every member reads the same values', async () => {
  const { self, state } = service({ roles: { admin: 'owner', bob: 'member' } });
  const saved = await updateSettings.call(self, actor('admin'), {
    baseUrl: 'http://kb.internal:18081',
    defaultKbId: 'kb-1',
    apiKey: 'secret-value',
  });
  assert.equal(saved.baseUrl, 'http://kb.internal:18081');
  assert.equal(saved.updatedBy, 'admin');
  assert.equal(state.size, 1, 'one row for the organization');

  // The member's own read, with a different principal, sees the same row.
  const member = await settings.call(self, actor('bob'));
  assert.equal(member.baseUrl, 'http://kb.internal:18081');
  assert.equal(member.defaultKbId, 'kb-1');
  assert.equal(member.canEdit, false);
  assert.equal(member.role, 'member', 'role reflects the caller, not the row');
  assert.equal(member.updatedBy, 'admin', 'the row records who last wrote it');
});

test('the key value never lands in the settings row', async () => {
  const { self, state, credentials } = service();
  await updateSettings.call(self, actor('admin'), { apiKey: 'secret-value' });
  const row = [...state.values()][0];
  assert.equal(JSON.stringify(row).includes('secret-value'), false);
  assert.deepEqual(credentials.writes, [[row.connection.apiKeyRef, 'secret-value']]);
  assert.equal(row.connection.apiKeyRef, 'WEKNORA_API_KEY');
});

test('a member is refused with a 403-class error instead of being silently ignored', async () => {
  const { self, state } = service({ role: 'member' });
  await assert.rejects(updateSettings.call(self, actor('bob'), { baseUrl: 'http://evil.example' }), (error) => {
    assert.equal(error.code, 'knowledge/forbidden');
    assert.match(error.message, /所有者或管理员/);
    return true;
  });
  assert.equal(state.size, 0, 'a refused write stores nothing');
});

test('an unidentified role is refused rather than assumed to be an administrator', async () => {
  const { self } = service({ role: undefined });
  await assert.rejects(updateSettings.call(self, actor('carol'), { baseUrl: 'http://kb.internal:18081' }), (error) => {
    assert.equal(error.code, 'knowledge/forbidden');
    assert.match(error.message, /无法确认/);
    return true;
  });
});

test('members still read settings when identity cannot report a role', async () => {
  const { self } = service({ role: undefined, stored: {} });
  const view = await settings.call(self, actor('carol'));
  assert.equal(view.canEdit, false);
  assert.equal(view.role, undefined);
});

test('an admin of one organization cannot read another organization row', async () => {
  const { self } = service({ role: 'admin', stored: { 'org_org-2': {
    schemaVersion: 2, organizationId: 'org-2', connection: { baseUrl: 'http://other:18081', apiKeyRef: 'WEKNORA_API_KEY', timeoutMs: 15000 }, updatedAt: new Date().toISOString(),
  } } });
  const view = await settings.call(self, actor('admin'));
  // org-1 has no row, so it falls back to defaults rather than borrowing org-2's.
  assert.equal(view.baseUrl, 'http://127.0.0.1:18081');
});

test('a version 1 row still parses, so an upgrade cannot fail the domain open', () => {
  // Rows written before the switch to organization scope sit on disk and are
  // parsed when the domain opens; rejecting them would break every startup.
  const legacy = {
    schemaVersion: 1,
    owner: { organizationId: 'org-1', principalId: 'alice' },
    connection: { baseUrl: 'http://127.0.0.1:18081', apiKeyRef: 'WEKNORA_API_KEY', timeoutMs: 15000 },
    updatedAt: new Date().toISOString(),
  };
  assert.equal(knowledgeStateSchema.safeParse(legacy).success, false, 'v1 is not the current shape');
  assert.equal(knowledgeStateStoredSchema.safeParse(legacy).success, true, 'but it must still be readable');

  const current = { schemaVersion: 2, organizationId: 'org-1', updatedBy: 'admin', connection: legacy.connection, updatedAt: legacy.updatedAt };
  assert.equal(knowledgeStateStoredSchema.safeParse(current).success, true);
});
