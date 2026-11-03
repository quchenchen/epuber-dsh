import * as React from 'react';
import { brandCss } from 'epuberdsh-ui';

/**
 * Presentation-only adapter for the pinned Harness layout. Never changes hit areas.
 *
 * Mounted once on `shell.overlay`, so this is the single place the product palette
 * reaches the whole app: `brandCss` publishes `--wd-*` and re-points the shared
 * `--dsw-alias-*` names inside every EpuberDSH panel root (see `productSurface`).
 * Panels therefore never declare a colour of their own, and a palette change stays
 * a one-line change in epuberdsh-ui.
 */
export function ShellAppearance() {
  return <style>{`${brandCss}
    [class$="_sidebarCol"] { border-right-color: transparent; }
    [data-platform="darwin"] [class$="_centerCol"] { border-left-color: transparent; }
    [data-side="sidebar"]:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
    [data-side="sidebar"][data-dragging] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent); }
  `}</style>;
}
