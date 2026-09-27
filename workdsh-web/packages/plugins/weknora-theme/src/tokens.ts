/**
 * WeKnora → dsh alias-token mapping.
 *
 * Every value below is a literal lifted from WeKnora's own front-end design
 * tokens, not invented: `WeKnora/frontend/src/assets/theme/theme.css`
 * (`--td-brand-color-1..10`, `--td-gray-color-1..14`, `--td-bg-color-*`,
 * `--td-text-color-*`, `--td-{error,success,warning}-color-*`, `--app-radius-*`).
 * Each line names its source token so the mapping stays auditable.
 *
 * Scope: the **alias layer only** — `--dsw-alias-*`, `--dsw-specific-*`,
 * `--dsw-radius-*`. The `--dsw-static-*` primitives are the official palette's
 * atoms; overriding them reaches into surfaces this skin has no business
 * guessing about, so they stay untouched.
 *
 * The first group is aligned one-to-one with the official token directory that
 * `ctx.theme.exportInspectTokens()` publishes (14 entries, each with a
 * description and `requiresLightAndDark: true`). The later groups are
 * coherence fills: without them the skin keeps dsh's near-black brand, its
 * blue-tinted neutrals and its loose corner scale, and the result reads as a
 * partially recoloured UI rather than a different product.
 *
 * Deliberately NOT overridden:
 * - `--dsw-focus-ring-color`: base declares it `transparent` under
 *   `html[data-input-modality=pointer]`, which suppresses rings on click. An
 *   inline body value would win over that rule and break the modality
 *   contract. The ring follows `--dsw-alias-state-business-primary` instead,
 *   which the first group rebinds.
 * - `--dsw-font-family`: dsh already resolves to a system stack with PingFang
 *   SC on macOS; WeKnora's stack is the same family. Repointing it would add
 *   risk without changing what the user sees.
 */

import type { ThemeTokenOverrides } from './theme-runtime.js';

/** Layer identity. One layer per source; re-registering replaces it wholesale. */
export const WEKNORA_SKIN_SOURCE = 'workdsh-plugin-weknora-theme';

/**
 * WeKnora brand green, from `--td-brand-color-N`.
 * Light mode keys off `-4`; the dark block re-declares the ramp so `-6`
 * becomes the dark brand and `-5`/`-9` its hover/text partners.
 */
const brand = {
  /** --td-brand-color-1 — the tinted accent surface. */
  tint: '#e9f8ec',
  /** --td-brand-color-3 — light `--td-brand-color-hover`. */
  hover: '#08dd6e',
  /** --td-brand-color-4 — light `--td-brand-color`. */
  primary: '#07c05f',
  /** --td-brand-color-5; in the dark block this level *is* `--td-brand-color`. */
  deep: '#06b04d',
  /** --td-brand-color-7 — dark enough to read as text on white (4.7:1). */
  text: '#038626',
  /** Dark block --td-brand-color-5 — dark `--td-brand-color-hover`. */
  darkHover: '#049b38',
  /** Dark block --td-brand-color-9 — legible on #181818. */
  darkText: '#09f479',
} as const;

/** WeKnora's neutral greys. Its ramp is untinted, unlike dsh's bluish neutrals. */
const gray = {
  g1: '#f3f3f3',
  g3: '#e7e7e7',
  g4: '#dcdcdc',
  g6: '#a6a6a6',
  g11: '#383838',
  g12: '#2c2c2c',
  g13: '#242424',
  g14: '#181818',
} as const;

/** WeKnora container and sidebar fills (`--td-bg-color-container`/`-sidebar`). */
const surface = {
  container: '#ffffff',
  sidebar: '#f9f9f9',
} as const;

/**
 * Group 1 — the official override directory, one entry per published token.
 * These are the surfaces the theme package itself advertises as third-party
 * override targets, so this group needs no justification beyond fidelity.
 */
const core: ThemeTokenOverrides = {
  // Application base background → WeKnora container / dark page.
  '--dsw-alias-bg-base': { light: surface.container, dark: gray.g14 },
  // Primary raised surface → container / dark container.
  '--dsw-alias-bg-layer-1': { light: surface.container, dark: gray.g13 },
  // Secondary nested surface → container / dark secondary container.
  '--dsw-alias-bg-layer-2': { light: surface.container, dark: gray.g12 },
  // Overlay and popover background.
  '--dsw-alias-bg-overlay': { light: surface.container, dark: gray.g13 },
  // Primary subtle border → --td-gray-color-3 / 8% white.
  '--dsw-alias-border-l1': { light: gray.g3, dark: '#ffffff14' },
  // Secondary stronger border → --td-gray-color-4 / 12% white.
  '--dsw-alias-border-l2': { light: gray.g4, dark: '#ffffff1f' },
  // Primary brand accent — the single most visible token in this skin.
  '--dsw-alias-brand-primary': { light: brand.primary, dark: brand.deep },
  // Primary text → --td-text-color-primary.
  '--dsw-alias-label-primary': { light: 'rgba(0, 0, 0, 0.9)', dark: 'rgba(255, 255, 255, 0.9)' },
  // Secondary text → --td-text-color-secondary.
  '--dsw-alias-label-secondary': { light: 'rgba(0, 0, 0, 0.6)', dark: 'rgba(255, 255, 255, 0.55)' },
  // --td-error-color-6 in each mode.
  '--dsw-alias-state-error-primary': { light: '#e34d59', dark: '#c64751' },
  // Inactive state → --td-gray-color-4 / -6.
  '--dsw-alias-state-idle-primary': { light: gray.g4, dark: gray.g6 },
  // --td-success-color-5 in each mode.
  '--dsw-alias-state-success-primary': { light: '#00a870', dark: '#059465' },
  // --td-warning-color-5 in each mode.
  '--dsw-alias-state-warn-primary': { light: '#ed7b2f', dark: '#cf6e2d' },
  // Sidebar column and title-row background → --td-bg-color-sidebar.
  '--dsw-specific-sidebar-fill': { light: surface.sidebar, dark: gray.g14 },
};

/**
 * Group 2 — brand coherence.
 *
 * dsh's light brand is near-black (`#0f1115`) and its links are DeepSeek blue,
 * so recolouring `brand-primary` alone leaves mismatched siblings: a green
 * primary button whose hover turns graphite, and blue links beside it.
 * Each entry rebinds one of those siblings to the WeKnora level that plays the
 * same role there.
 */
const brandCoherence: ThemeTokenOverrides = {
  // Brand text → the deepest legible ramp level, not the fill colour.
  '--dsw-alias-brand-text': { light: brand.text, dark: brand.darkText },
  // Primary button hover → WeKnora's own `--td-brand-color-hover` per mode.
  '--dsw-alias-button-primary-hover': { light: brand.hover, dark: brand.darkHover },
  // Muted primary fill: base tints its neutral, so mix the brand instead.
  '--dsw-alias-button-primary-dimmed': {
    light: 'color-mix(in srgb, #07c05f 26%, #ffffff)',
    dark: 'color-mix(in srgb, #06b04d 28%, #181818)',
  },
  // Links follow WeKnora, whose `--td-text-color-link` is the brand colour.
  '--dsw-alias-link': { light: brand.text, dark: brand.darkText },
  // Focus-ring fallback and business accents; keeps rings off DeepSeek blue.
  '--dsw-alias-state-business-primary': { light: brand.primary, dark: brand.deep },
  '--dsw-alias-state-business-tertiary': {
    light: brand.tint,
    dark: 'color-mix(in srgb, #06b04d 20%, #181818)',
  },
  // Info buttons are brand-filled in dsh; keep them in the same family.
  '--dsw-alias-button-info-fill': { light: brand.primary, dark: brand.deep },
  '--dsw-alias-button-info-hover': { light: brand.hover, dark: brand.darkHover },
};

/**
 * Group 3 — neutral temperature.
 *
 * dsh's neutrals carry a blue cast (`#f1f3f5`, `#151517`) and its hover fills
 * are blue-grey. WeKnora's greys are pure and its selection surface is a
 * neutral overlay, not a brand wash — `--app-selection-bg` is
 * `color-mix(in srgb, text 4%, container)`. Matching that is what stops the
 * skin from reading as "dsh with green buttons".
 */
const neutralTemperature: ThemeTokenOverrides = {
  // Hover/active overlays: base uses a blue-grey, WeKnora a neutral one.
  '--dsw-alias-interactive-bg-hover': { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.08)' },
  '--dsw-alias-interactive-bg-active': { light: 'rgba(0, 0, 0, 0.08)', dark: 'rgba(255, 255, 255, 0.12)' },
  '--dsw-alias-interactive-bg-hover-solid': { light: gray.g1, dark: gray.g11 },
  // Sidebar navigation, following --app-selection-bg / --td-bg-color-container-hover.
  '--dsw-specific-sidebar-nav-item-hover': { light: gray.g1, dark: gray.g12 },
  '--dsw-specific-sidebar-nav-item-active': { light: gray.g1, dark: gray.g12 },
  // The active-item accent is the one place WeKnora does tint with the brand:
  // --app-selection-border is `color-mix(brand 30%, stroke)`.
  '--dsw-specific-sidebar-nav-item-active-accent': {
    light: 'color-mix(in srgb, #07c05f 30%, #e7e7e7)',
    dark: 'color-mix(in srgb, #06b04d 34%, #2c2c2c)',
  },
  // The user's composer bubble is blue-tinted in dsh; WeKnora tints with brand.
  '--dsw-specific-bubble': { light: brand.tint, dark: gray.g12 },
  '--dsw-specific-bubble-highlight': {
    light: 'color-mix(in srgb, #07c05f 30%, #ffffff)',
    dark: 'color-mix(in srgb, #06b04d 22%, #181818)',
  },
  // Input and selector fills → --td-bg-color-container / secondarycontainer.
  '--dsw-specific-input-major': { light: surface.container, dark: gray.g12 },
  '--dsw-specific-selector': { light: gray.g1, dark: gray.g12 },
  '--dsw-specific-login-input': { light: gray.g1, dark: gray.g14 },
  // Code surfaces: base uses a bluish neutral, WeKnora uses --td-gray-color-1.
  '--dsw-alias-markdown-code-block': { light: gray.g1, dark: gray.g12 },
  '--dsw-alias-markdown-inline-code': { light: gray.g1, dark: gray.g12 },
  '--dsw-alias-markdown-citation': {
    light: brand.tint,
    dark: 'color-mix(in srgb, #06b04d 18%, #181818)',
  },
};

/**
 * Group 4 — corner scale.
 *
 * The most opinionated group. dsh runs 4/8/12/16/20/28; WeKnora's `--app-radius-*`
 * runs 4/6/8/10/12. Six dsw steps are mapped onto five WeKnora steps by
 * matching the tier each level is used for (control → control, card → card),
 * and `panel` — which WeKnora has no equivalent of — clamps to its ceiling.
 *
 * Radii only ever shrink, so no surface can start clipping content. If this
 * group is unwanted, delete it and the skin keeps Groups 1–3.
 */
const cornerScale: ThemeTokenOverrides = {
  '--dsw-radius-xs': { light: '4px', dark: '4px' }, // --app-radius-xs
  '--dsw-radius-sm': { light: '6px', dark: '6px' }, // --app-radius-sm
  '--dsw-radius-md': { light: '8px', dark: '8px' }, // --app-radius-md
  '--dsw-radius-lg': { light: '10px', dark: '10px' }, // --app-radius-lg
  '--dsw-radius-xl': { light: '12px', dark: '12px' }, // --app-radius-xl
  '--dsw-radius-panel': { light: '12px', dark: '12px' }, // clamped to --app-radius-xl
};

export const weknoraCoreTokens = core;
export const weknoraBrandTokens = brandCoherence;
export const weknoraNeutralTokens = neutralTemperature;
export const weknoraCornerTokens = cornerScale;

/** Every token this skin overrides, as one layer. */
export const weknoraSkinTokens: ThemeTokenOverrides = {
  ...core,
  ...brandCoherence,
  ...neutralTemperature,
  ...cornerScale,
};

/** Token names, for probes and documentation. */
export const weknoraSkinTokenNames: readonly string[] = Object.keys(weknoraSkinTokens);
