/**
 * workdsh-plugin-weknora-theme: a WeKnora-flavoured visual skin for WorkDSH.
 *
 * Presentation only. The Host contributes no service, no tool and no storage —
 * the browser half registers an alias-token layer through the official
 * `ctx.theme` seam, so installing or removing the package is the whole toggle.
 *
 * @module workdsh-plugin-weknora-theme
 */

export const name = 'workdsh-plugin-weknora-theme';

/** Client-only presentation; no Host execution or storage services. */
export function apply(): void {}

export { WEKNORA_SKIN_SOURCE, weknoraSkinTokens, weknoraSkinTokenNames } from './tokens.js';
export type { SkinContext, ThemeRuntimeLike, ThemeTokenModes, ThemeTokenOverrides } from './theme-runtime.js';
