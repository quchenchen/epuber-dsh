/** Verify the unsigned Windows x64 NSIS installer and unpacked executable. */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOfficialPrimaryRuntime } from './official-runtime-provenance.mjs'

/** Verify a complete in-memory Windows PE image. */
export function assertPortableExecutableBuffer(data: Buffer, label: string, source: string): void {
  if (data.byteLength < 68 || data.subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`${label} does not have a Windows PE header: ${source}`)
  }
  const peOffset = data.readUInt32LE(0x3c)
  if (peOffset > data.byteLength - 4) {
    throw new Error(`${label} has an invalid Windows PE offset: ${source}`)
  }
  if (!data.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))) {
    throw new Error(`${label} does not have a Windows PE signature: ${source}`)
  }
}

/** Paths returned after Windows installer verification succeeds. */
export interface WindowsInstallerArtifacts {
  /** NSIS installer path. */
  readonly installerPath: string
  /** Unpacked application executable path. */
  readonly applicationPath: string
}

/** Injectable Windows installer verification boundary. */
export interface WindowsInstallerVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
}

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

/** Electron Builder names the artifact and the executable after the configured product name. */
function readProductName(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    build?: { productName?: unknown }
  }
  const productName = manifest.build?.productName
  if (typeof productName !== 'string' || productName.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no build.productName`)
  }
  return productName
}

/** Verify that a generated Windows artifact has a valid PE header. */
export function assertPortableExecutable(path: string, label: string): void {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 68) {
    throw new Error(`${label} is not a non-empty regular file: ${path}`)
  }
  const descriptor = openSync(path, 'r')
  const dosHeader = Buffer.alloc(64)
  try {
    const dosBytesRead = readSync(descriptor, dosHeader, 0, dosHeader.byteLength, 0)
    if (dosBytesRead !== dosHeader.byteLength || dosHeader.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`${label} does not have a Windows PE header: ${path}`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > stat.size - 4) {
      throw new Error(`${label} has an invalid Windows PE offset: ${path}`)
    }
    const signature = Buffer.alloc(4)
    const signatureBytesRead = readSync(descriptor, signature, 0, signature.byteLength, peOffset)
    if (signatureBytesRead !== signature.byteLength || !signature.equals(Buffer.from('PE\0\0'))) {
      throw new Error(`${label} does not have a Windows PE signature: ${path}`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function defaultOptions(): WindowsInstallerVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    desktopRoot,
    version: readVersion(desktopRoot),
  }
}

/**
 * Verify the exact NSIS installer and unpacked application executable.
 * @param options - Artifact root and expected product version.
 * @returns The verified artifact paths.
 */
export function verifyWindowsInstaller(
  options: WindowsInstallerVerificationOptions = defaultOptions(),
): WindowsInstallerArtifacts {
  const distDir = join(options.desktopRoot, 'dist')
  // Both names come from the build configuration: a renamed product must not need
  // this verifier edited in lockstep, which is exactly how the two drifted apart.
  const productName = readProductName(options.desktopRoot)
  const installerPath = join(
    distDir,
    `${productName}-${options.version}-x64-Setup.exe`,
  )
  const applicationPath = join(distDir, 'win-unpacked', `${productName}.exe`)

  assertPortableExecutable(installerPath, 'Windows NSIS installer')
  assertPortableExecutable(applicationPath, 'unpacked Windows application')
  const runtimeRoot = join(distDir, 'win-unpacked', 'resources', 'workdsh-runtime', 'primary-runtime')
  const runtime: unknown = JSON.parse(readFileSync(join(runtimeRoot, 'runtime.json'), 'utf8'))
  // The bundled interpreters come from an official Desktop archive, which is versioned on
  // its own release line. Comparing it against the npm DSH version rejects a correct build.
  try { assertOfficialPrimaryRuntime(runtime, 'win-x64') }
  catch (error) {
    throw new Error(`Windows installer has mismatched bundled primary runtime: ${JSON.stringify(runtime)} (${(error as Error).message})`)
  }
  assertPortableExecutable(join(runtimeRoot, 'dependencies', 'python', 'python.exe'), 'bundled Python')
  assertPortableExecutable(join(runtimeRoot, 'dependencies', 'node', 'bin', 'node.exe'), 'bundled Node')
  return { installerPath, applicationPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyWindowsInstaller()
    console.log(`Windows installer verification passed: ${verified.installerPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
