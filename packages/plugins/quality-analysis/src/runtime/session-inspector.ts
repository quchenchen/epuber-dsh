import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence';

export type QualitySessionInspection = Pick<SessionInspection, 'meta' | 'events'>;

/** Owned-Session reads always use the governed bridge mounted with the access
 * plugin: it performs the fixed-member and ownership checks around the official
 * cold read, so nothing here re-implements Session activation or probing. */
export function qualitySessionInspector(ctx: Context) {
  const bridge = ctx.get('workdshSessionAccess') as
    | { inspect(sessionId: SessionId, signal?: AbortSignal): Promise<SessionInspection> }
    | undefined;
  if (!bridge) throw Error('quality/service/session-unavailable');
  return (sessionId: string, signal?: AbortSignal): Promise<QualitySessionInspection> =>
    bridge.inspect(sessionId as SessionId, signal);
}
