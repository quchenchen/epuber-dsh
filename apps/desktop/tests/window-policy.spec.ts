import { describe, expect, it } from 'vitest'
import { secondInstanceAction, shouldQuitWithoutWindows, type WindowSignals } from '../src/window-policy.ts'

const idle: WindowSignals = { hasWindow: false, quitting: false, switching: false, runtimeStarting: false, installing: false }

describe('secondInstanceAction', () => {
  it('focuses a live window even while a transition runs', () => {
    expect(secondInstanceAction({ ...idle, hasWindow: true, switching: true })).toBe('focus')
  })

  it('ignores a launch that arrives while shutting down', () => {
    expect(secondInstanceAction({ ...idle, quitting: true, hasWindow: true })).toBe('ignore')
  })

  it('waits when a window is still coming', () => {
    expect(secondInstanceAction({ ...idle, switching: true })).toBe('wait')
    expect(secondInstanceAction({ ...idle, runtimeStarting: true })).toBe('wait')
    expect(secondInstanceAction({ ...idle, installing: true })).toBe('wait')
  })

  it('restarts a process that kept running without a window', () => {
    expect(secondInstanceAction(idle)).toBe('relaunch')
  })
})

describe('shouldQuitWithoutWindows', () => {
  it('quits on Windows once every window closed', () => {
    expect(shouldQuitWithoutWindows('win32', { hasWindow: false, quitting: false })).toBe(true)
  })

  it('keeps a windowless macOS app in the Dock', () => {
    expect(shouldQuitWithoutWindows('darwin', { hasWindow: false, quitting: false })).toBe(false)
  })

  it('never quits while a window is open or shutdown already runs', () => {
    expect(shouldQuitWithoutWindows('win32', { hasWindow: true, quitting: false })).toBe(false)
    expect(shouldQuitWithoutWindows('win32', { hasWindow: false, quitting: true })).toBe(false)
  })
})
