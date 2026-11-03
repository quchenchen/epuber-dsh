import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-session.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createWorkbenchDevelopmentSessionVerifier: verifier } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const nativeBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/native-development-session.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createNativeWorkbenchDevelopmentSessionVerifier: nativeVerifier } = await import(`data:text/javascript;base64,${Buffer.from(nativeBuilt.outputFiles[0].text).toString('base64')}`);
const actor = { principalId: 'member', organizationId: 'org', requestId: 'test', resolvedBy: 'fixture' };
test('native adapter reads owned Sessions only through the governed bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'epuberdsh-native-session-'));
  try {
    let kind = 'personal', owner = { ownerPrincipalId: 'member', organizationId: 'org' }, reads = 0;
    const services = {
      epuberdshIdentity: { resolve: async () => actor, profile: () => ({ principalId: 'member', organization: { id: 'org', kind } }), membership: () => ({ state: 'active' }) },
      epuberdshAccess: { sessionOwner: () => owner },
      sessionController: {},
      epuberdshSessionAccess: { inspect: async () => { reads++; return { meta: { cwd: root }, events: [] }; } },
    };
    const ctx = { get: name => services[name] };
    const development = { target: { hostId: 'host' }, source: { hostId: 'host', directory: root, revision: 'source-1' } };
    assert.equal((await nativeVerifier(ctx, 'session-1')(actor, development)).sessionId, 'session-1');
    assert.equal(reads, 1);
    owner = undefined;
    await assert.rejects(nativeVerifier(ctx, 'session-1')(actor, development), /access-denied/);
    assert.equal(reads, 1, 'unowned Session is not silently adopted or read');
    owner = { ownerPrincipalId: 'other', organizationId: 'org' };
    await assert.rejects(nativeVerifier(ctx, 'session-1')(actor, development), /access-denied/);
    assert.equal(reads, 1);
    owner = { ownerPrincipalId: 'member', organizationId: 'org' }; kind = 'enterprise';
    await nativeVerifier(ctx, 'session-1')(actor, development);
    assert.equal(reads, 2, 'enterprise reads also go through the protected bridge');
    // A composition without the governed bridge cannot read any owned Session.
    delete services.epuberdshSessionAccess;
    assert.throws(() => nativeVerifier(ctx, 'session-1'), /session-authority-unavailable/);
    assert.equal(reads, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('cold metadata must resolve to the source directory and pass access checks on both sides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'epuberdsh-session-workspace-'));
  try {
    const source = join(root, 'source'), alias = join(root, 'alias'), other = join(root, 'other');
    await Promise.all([mkdir(source), mkdir(other)]); await symlink(source, alias, 'dir');
    const development = { target: { hostId: 'host' }, source: { hostId: 'host', directory: source, revision: 'source-1' } };
    let checks = 0, cwd = alias;
    const inspect = async id => { assert.equal(id, 'session-1'); return { meta: { cwd } }; };
    const authorize = async (resolved, id) => { assert.equal(resolved.principalId, 'member'); assert.equal(id, 'session-1'); checks++; };
    const verify = verifier('session-1', { authorize, inspect });
    assert.deepEqual(await verify(actor, development), { hostId: 'host', sessionId: 'session-1' });
    assert.equal(checks, 2);
    cwd = other;
    await assert.rejects(verify(actor, development), /workspace-mismatch/);
    await assert.rejects(verify(actor, { ...development, source: undefined }), /source-unavailable/);
    await assert.rejects(verify(actor, { ...development, source: { ...development.source, hostId: 'other' } }), /source-unavailable/);
    cwd = source; let revocations = 0;
    await assert.rejects(verifier('session-1', { inspect, authorize: async () => { if (++revocations === 2) throw new Error('revoked'); } })(actor, development), /revoked/);
    const abort = new AbortController();
    await assert.rejects(verifier('session-1', { authorize, inspect: async () => { abort.abort(); return { meta: { cwd: source } }; } })(actor, development, abort.signal), { name: 'AbortError' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
