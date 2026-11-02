// Domain tests supply explicit Host facts. They do not infer ownership from the
// session ID passed to linkTask, which is untrusted request data.
export function provideSessionAuthority(ctx, actor, options = {}) {
  const sessions = new Set(options.sessions ?? ['session-1', 'session-2', 'empty', 'default', 'bad']);
  const owners = options.owners ?? new Map([...sessions].map(sessionId => [sessionId, {
    sessionId, organizationId: actor.organizationId, ownerPrincipalId: actor.principalId, revision: 'fixture-owner-1',
  }]));
  const inspections = [];
  const membership = { organizationId: actor.organizationId, principalId: actor.principalId, state: 'active' };
  ctx.provide('workdshIdentity', {
    id: options.enterprise ? 'workdsh-enterprise-desktop' : 'workdsh-identity-local',
    resolve: async (_evidence, signal) => { signal?.throwIfAborted(); return actor; },
    profile: () => ({ principalId: actor.principalId, organization: { id: actor.organizationId, kind: options.enterprise ? 'team' : 'personal' }, membership, resolvedBy: actor.resolvedBy }),
    membership: (organizationId, principalId) => organizationId === actor.organizationId && principalId === actor.principalId ? membership : undefined,
  });
  ctx.provide('workdshAccess', {
    sessionOwner: sessionId => owners.get(sessionId),
    bindSession: async (current, { sessionId }, signal) => {
      signal?.throwIfAborted();
      if (owners.has(sessionId)) throw new Error('fixture/owner-already-bound');
      const binding = { sessionId, organizationId: current.organizationId, ownerPrincipalId: current.principalId, revision: 'fixture-owner-2' };
      owners.set(sessionId, binding);
      return binding;
    },
  });
  if (options.sessionAccess !== false) ctx.provide('workdshSessionAccess', {
    inspect: async (sessionId, signal) => {
      signal?.throwIfAborted(); inspections.push(sessionId);
      if (!sessions.has(sessionId)) throw new Error('session/not-found');
      return { meta: { id: sessionId }, events: [] };
    },
  });
  // Cold-read seam the governed bridge uses; absent identities surface as not-found.
  ctx.provide('sessionPersistence', {
    async open(sessionId) {
      if (!sessions.has(sessionId)) throw Object.assign(new Error(`session "${sessionId}" not found`), { code: 'session/not-found' });
      return { header: { id: sessionId }, inheritedEventCount: 0, async read() { return { events: [] }; }, async close() {} };
    },
  });
  ctx.provide('sessionController', {});
  return { sessions, owners, inspections };
}
