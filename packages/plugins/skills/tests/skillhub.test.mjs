import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicFailure } from '../dist/services/connection-api.js';
import {
  normalizeRegistryUrl, skillHubSegment, toSkillHubCard, unwrapSkillHubEnvelope,
} from '../dist/services/skillhub.js';

test('registry addresses normalize to an origin plus base path', () => {
  assert.equal(normalizeRegistryUrl('  https://skillhub.example.com/  '), 'https://skillhub.example.com');
  assert.equal(normalizeRegistryUrl('http://127.0.0.1:8080/skillhub/'), 'http://127.0.0.1:8080/skillhub');
  // A token must never be smuggled inside the address.
  assert.throws(() => normalizeRegistryUrl('https://user:pass@example.com'), /skillhub\/invalid-address/);
  assert.throws(() => normalizeRegistryUrl('ftp://example.com'), /skillhub\/invalid-address/);
  assert.throws(() => normalizeRegistryUrl('not a url'), /skillhub\/invalid-address/);
});

test('path segments refuse traversal instead of encoding it', () => {
  assert.equal(skillHubSegment('media-headline-check'), 'media-headline-check');
  assert.equal(skillHubSegment('2.10.2'), '2.10.2');
  assert.throws(() => skillHubSegment('../etc/passwd'), /skillhub\/invalid-target/);
  assert.throws(() => skillHubSegment('a/b'), /skillhub\/invalid-target/);
  assert.throws(() => skillHubSegment(''), /skillhub\/invalid-target/);
  assert.throws(() => skillHubSegment(undefined), /skillhub\/invalid-target/);
});

test('both the portal envelope and a bare body unwrap', () => {
  assert.deepEqual(unwrapSkillHubEnvelope({ items: [1] }), { items: [1] });
  assert.deepEqual(unwrapSkillHubEnvelope({ code: 0, data: { total: 3 } }), { total: 3 });
  assert.throws(() => unwrapSkillHubEnvelope({ code: 40000, msg: 'no' }), /skillhub\/bad-response/);
  assert.throws(() => unwrapSkillHubEnvelope(null), /skillhub\/bad-response/);
});

test('portal rows and version-first rows map to the same card', () => {
  const portal = toSkillHubCard({
    slug: 'media-headline-check', displayName: '标题合规检查', summary: '检查标题是否夸大。',
    namespace: 'global', ownerDisplayName: 'Platform Admin', labels: [{ name: '内容质量' }],
    downloadCount: 2, publishedVersion: { version: '20261101.115519' }, updatedAt: '2026-11-01T11:55:19Z',
  }, 'global', new Set(['media-headline-check']));
  assert.deepEqual(portal, {
    slug: 'media-headline-check', namespace: 'global', name: '标题合规检查', description: '检查标题是否夸大。',
    version: '20261101.115519', owner: 'Platform Admin', labels: ['内容质量'], downloads: 2,
    updatedAt: '2026-11-01T11:55:19Z', installed: true,
  });

  const versioned = toSkillHubCard({
    slug: 'zero-slop', summary: 'Rewrite formulaic prose.', stats: { downloads: 7 }, headlineVersion: { version: '2.10.2' },
  }, 'team-editorial', new Set());
  assert.equal(versioned.namespace, 'team-editorial');
  assert.equal(versioned.name, 'zero-slop');
  assert.equal(versioned.downloads, 7);
  assert.equal(versioned.installed, false);
  assert.equal(versioned.labels, undefined);
});

test('a row without a slug is dropped rather than rendered as a broken card', () => {
  assert.equal(toSkillHubCard({ displayName: 'x' }, 'global', new Set()), undefined);
});

test('catalog failures keep their own code instead of collapsing into one message', () => {
  // `skillhub/` is a sibling of `skill/`: a naive `startsWith('skill/')` test
  // turned every catalog error into the generic "技能操作失败".
  const unreachable = publicFailure(new Error('skillhub/unreachable'));
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.error.code, 'skillhub/unreachable');
  assert.match(unreachable.error.message, /无法连接技能中心/);

  const credential = publicFailure(new Error('skillhub/credential-write-failed'));
  assert.equal(credential.error.code, 'skillhub/credential-write-failed');
  assert.match(credential.error.message, /凭据存储/);

  // Existing skill codes must keep working.
  const skill = publicFailure(new Error('skill/target-exists'));
  assert.equal(skill.error.code, 'skill/target-exists');
  assert.match(skill.error.message, /同名技能/);

  // Anything unexpected still degrades to the generic message, never a raw stack.
  const unknown = publicFailure(new Error('ECONNREFUSED something raw'));
  assert.equal(unknown.error.code, 'skill/internal');
  assert.doesNotMatch(unknown.error.message, /ECONNREFUSED/);
});
