/**
 * The slice of the official theme contract this plugin consumes.
 *
 * It mirrors `@deepseek-ai/dsh-client-ui-theme/client` (0.1.7-rc.2) —
 * `ThemeRuntime.overrideTokens(source, tokens)` plus the `Context.theme`
 * augmentation — and deliberately keeps the plugin free of a build-time
 * dependency on the browser package: this workspace links client UI packages
 * per-package, and a skin must not be the reason a checkout stops typechecking.
 *
 * `overrideTokens` is the documented third-party seam ("A composition can
 * register a third-party theme id with alias-token overrides through
 * `ctx.theme`"). We use the token-layer half only: `register()` would add a
 * selectable theme whose id cannot cross the built-in settings schema, so the
 * choice would not survive a restart.
 */
export interface ThemeTokenModes {
  /** Value applied while the light base palette is active. */
  readonly light: string;
  /** Value applied while the dark base palette is active. */
  readonly dark: string;
}

/** Token name → per-mode value pairs. Both modes are mandatory. */
export type ThemeTokenOverrides = Readonly<Record<string, ThemeTokenModes>>;

export interface ThemeRuntimeLike {
  /**
   * Stack a token layer over the active theme. Later layers win per token;
   * disposing restores whatever this layer covered.
   * @param source - layer identity; one layer per source.
   * @param tokens - token-name → `{ light, dark }` value pairs.
   * @returns disposer removing exactly the layer this call created.
   */
  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void;
}

/** The Cordis context this plugin's `apply` receives. */
export interface SkinContext {
  readonly theme: ThemeRuntimeLike;
  /**
   * Run a factory now and register its returned disposer with the owning
   * fiber, so unloading the plugin withdraws the layer.
   * @param factory - returns the disposer.
   * @param label - effect identity used in diagnostics.
   */
  effect(factory: () => () => void, label: string): void;
}
