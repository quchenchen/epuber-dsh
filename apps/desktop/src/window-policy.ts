/** Pure window decisions, so the windowless-process traps stay testable. */

/** Signals that decide what a second launch should do. */
export interface WindowSignals {
  /** A live window exists and can be focused. */
  readonly hasWindow: boolean
  /** The application is already shutting down. */
  readonly quitting: boolean
  /** A workspace transition is in flight and will open its own window. */
  readonly switching: boolean
  /** The official Host is starting and will open its own window. */
  readonly runtimeStarting: boolean
  /** A package-manager command is running and will open its own window. */
  readonly installing: boolean
}

/** What an incoming second launch does. */
export type SecondInstanceAction = 'focus' | 'wait' | 'relaunch' | 'ignore'

/**
 * A second launch must never be swallowed. Focusing a live window is enough;
 * when the first process kept running without any window, the user has nothing
 * to click, so restarting it is the only honest response.
 */
export function secondInstanceAction(signals: WindowSignals): SecondInstanceAction {
  if (signals.quitting) return 'ignore'
  if (signals.hasWindow) return 'focus'
  if (signals.switching || signals.runtimeStarting || signals.installing) return 'wait'
  return 'relaunch'
}

/**
 * Closing the last window must end the process. A windowless process keeps the
 * single-instance lock, so every later launch quits immediately and the
 * product looks broken. macOS keeps the app alive in the Dock by design.
 */
export function shouldQuitWithoutWindows(
  platform: NodeJS.Platform | string,
  state: { readonly hasWindow: boolean, readonly quitting: boolean },
): boolean {
  if (platform === 'darwin') return false
  return !state.hasWindow && !state.quitting
}
