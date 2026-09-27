/**
 * Browser half: stack the WeKnora token layer over the official palette.
 *
 * The official theme runtime keeps owning the light/dark/system preference and
 * the DOM presentation; this plugin only contributes a value layer. That is
 * deliberate — an earlier WorkDSH client registered its own theme and vetoed
 * `theme/change`, which pinned the palette and broke the Appearance switch
 * (see `packages/bundle/CHANGELOG.md`). Overriding tokens cannot reproduce that
 * failure: nothing here calls `setTheme`, reads the snapshot or subscribes to
 * the event, and disposing the layer restores whatever it covered.
 */

import { WEKNORA_SKIN_SOURCE, weknoraSkinTokens } from './tokens.js';
import type { SkinContext } from './theme-runtime.js';

export const name = 'workdsh-weknora-theme-client';

/** The official registry/override service; the layer is registered against it. */
export const inject = ['theme'];

export function apply(ctx: SkinContext): void {
  ctx.effect(
    () => ctx.theme.overrideTokens(WEKNORA_SKIN_SOURCE, weknoraSkinTokens),
    'workdsh.weknora-theme.tokens',
  );
}
