import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { officialDesktopArtifact, officialRuntimeLock } from '../scripts/official-runtime-provenance.mjs'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWindowsInstaller } from '../scripts/verify-win-installer.ts'

const temporaryRoots: string[] = []

function portableExecutable(): Buffer {
  const executable = Buffer.alloc(132)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(128, 0x3c)
  executable.write('PE\0\0', 128, 'binary')
  return executable
}

/** Electron Builder derives both names from build.productName, so the fixture must declare it. */
const PRODUCT_NAME = 'EpuberDSH'

function fixture(version = '2.0.0'): {
  readonly root: string
  readonly installer: string
  readonly application: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-win-installer-'))
  temporaryRoots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop', version, build: { productName: PRODUCT_NAME } }))
  const dist = join(root, 'dist')
  const unpacked = join(dist, 'win-unpacked')
  mkdirSync(unpacked, { recursive: true })
  const installer = join(dist, `${PRODUCT_NAME}-${version}-x64-Setup.exe`)
  const application = join(unpacked, `${PRODUCT_NAME}.exe`)
  writeFileSync(installer, portableExecutable())
  writeFileSync(application, portableExecutable())
  const runtime = join(unpacked, 'resources', 'workdsh-runtime', 'primary-runtime')
  mkdirSync(join(runtime, 'dependencies', 'python'), { recursive: true })
  mkdirSync(join(runtime, 'dependencies', 'node', 'bin'), { recursive: true })
  // The bundled interpreters are versioned by their own archive, not by the npm DSH release.
  const artifact = officialDesktopArtifact('win-x64')
  writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ desktopVersion: artifact.version, platform: 'win32', arch: 'x64', ...officialRuntimeLock.primaryRuntime, payloadDigest: 'a'.repeat(64) }))
  writeFileSync(join(runtime, 'dependencies', 'python', 'python.exe'), portableExecutable())
  writeFileSync(join(runtime, 'dependencies', 'node', 'bin', 'node.exe'), portableExecutable())
  return { root, installer, application }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Windows installer artifact verification', () => {
  it('accepts the exact versioned NSIS installer and unpacked application', () => {
    const value = fixture()

    expect(verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' })).toEqual({
      installerPath: value.installer,
      applicationPath: value.application,
    })
  })

  it('rejects a stale installer from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow(`${PRODUCT_NAME}-2.0.0-x64-Setup.exe`)
  })

  it('rejects an artifact without a Windows PE header', () => {
    const value = fixture()
    const invalid = portableExecutable()
    invalid.write('NO', 0, 'ascii')
    writeFileSync(value.installer, invalid)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE header')
  })

  it('rejects an unpacked application without a Windows PE signature', () => {
    const value = fixture()
    const invalid = portableExecutable()
    invalid.fill(0, 128, 132)
    writeFileSync(value.application, invalid)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE signature')
  })

  it('rejects a missing bundled Python executable', () => {
    const value = fixture()
    rmSync(join(value.root, 'dist', 'win-unpacked', 'resources', 'workdsh-runtime', 'primary-runtime', 'dependencies', 'python', 'python.exe'))

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('python.exe')
  })
})
