import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence';

/** Read-only persistence seam for fixtures. Mirrors the official
 * `persistence.open(id, 'read')` handle contract used by the governed cold
 * read, so tests exercise the same seam the product uses instead of a
 * Controller method that no longer exists. */
export function coldReadPersistence(read) {
  return {
    async open(sessionId, mode, options) {
      if (mode !== 'read') throw new Error(`fixture persistence only serves reads, got ${mode}`);
      const key = String(sessionId);
      const value = await read(key, options?.signal);
      if (value === undefined) throw new SessionPersistenceNotFoundError(key);
      const events = [...(value.events ?? [])];
      return {
        header: value.header ?? { id: key },
        inheritedEventCount: value.inheritedEventCount ?? 0,
        async read() { return { events: [...events] }; },
        async close() {},
      };
    },
  };
}
