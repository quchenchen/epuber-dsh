/** Consume fixed official binary releases; never fetch a source checkout. */
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import {officialRuntimeLock,officialDesktopArtifact,assertOfficialPrimaryRuntime,writeOfficialRuntimeProvenance,verifyOfficialRuntimeProvenance,OFFICIAL_PROVENANCE_FILE} from './official-runtime-provenance.mjs'
export const lock = officialRuntimeLock
// Older copies rewrote relative links to extraction-directory absolute paths.
const COPY_FORMAT = 3
function cacheIdentity(target, artifact) {
  return JSON.stringify({ copyFormat: COPY_FORMAT, npmDshVersion: lock.version, target, artifact })
}
export function copyOfficialRuntime(source, destination) {
  // Replace an earlier prepared payload rather than retaining stale links/files.
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true, force: true, dereference: false, verbatimSymlinks: true })
}

/**
 * Digest of the immutable runtime payload: sha256 over the sorted
 * "<sha256 or link target>  <relative path>" lines of primary-runtime.
 * runtime.json describes the payload and the provenance receipt is ours, so
 * neither participates. Recomputed on every cache reuse, so a partially written
 * or tampered payload cannot pass as a prepared runtime.
 */
export function payloadDigest(primary) {
  const entries = []
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (prefix === '' && (entry.name === 'runtime.json' || entry.name === OFFICIAL_PROVENANCE_FILE)) continue
      const name = prefix === '' ? entry.name : prefix + '/' + entry.name
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { walk(path, name); continue }
      if (entry.isSymbolicLink()) { entries.push({ name, hash: 'link:' + readlinkSync(path) }); continue }
      if (!entry.isFile()) continue
      entries.push({ name, hash: createHash('sha256').update(readFileSync(path)).digest('hex') })
    }
  }
  walk(primary, '')
  return createHash('sha256')
    .update(entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(entry => entry.hash + '  ' + entry.name).join('\n') + '\n')
    .digest('hex')
}

const CPU = { x64: { macho: 0x01000007, pe: 0x8664 }, arm64: { macho: 0x0100000c, pe: 0xaa64 } }
/** Identify a native executable or shared object by its CPU type. */
function executableCpu(path) {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4096)
    const read = readSync(fd, header, 0, header.length, 0)
    if (read >= 8 && header.readUInt32LE(0) === 0xfeedfacf) return { format: 'Mach-O', cpu: header.readUInt32LE(4) }
    if (read >= 0x40 && header[0] === 0x4d && header[1] === 0x5a) {
      const offset = header.readUInt32LE(0x3c)
      if (offset + 6 <= read && header.readUInt32LE(offset) === 0x00004550) return { format: 'PE', cpu: header.readUInt16LE(offset + 4) }
    }
    return undefined
  } finally { closeSync(fd) }
}

/**
 * Refuse to assemble a runtime whose load-bearing executables were built for
 * another machine. Composition mixes two archives, so this is what proves the
 * mixing is sound.
 *
 * Only the trees the runtime actually loads are checked: the Node binary, the
 * bundled Python (interpreter, native extensions, wheels) and the CLI helpers.
 * pnpm ships per-platform prebuilds for every platform it supports (for example
 * @reflink/reflink-darwin-arm64) and picks one at run time, and pip vendors
 * Windows test fixtures; neither can execute here, so neither is a defect.
 */
const LOAD_BEARING = ['primary-runtime/dependencies/node', 'primary-runtime/dependencies/python', 'cli']
export function assertExecutableArchitecture(directory, arch, platform) {
  const expected = CPU[arch]
  if (expected === undefined) throw new Error('Unknown architecture for executable verification: ' + arch)
  const wanted = platform === 'win' ? 'pe' : 'macho'
  const foreign = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.isFile()) continue
      const found = executableCpu(path)
      if (found === undefined) continue
      // A macOS runtime never executes PE files and a Windows runtime never
      // executes Mach-O files, so the other format is not load-bearing.
      if ((found.format === 'PE') !== (wanted === 'pe')) continue
      if (found.cpu === expected[found.format === 'PE' ? 'pe' : 'macho']) continue
      foreign.push(relative(directory, path) + ' (' + found.format + ')')
    }
  }
  for (const tree of LOAD_BEARING) {
    const path = join(directory, tree)
    if (existsSync(path)) walk(path)
  }
  if (foreign.length > 0) {
    throw new Error(`A ${arch} runtime must not carry ${foreign.length} executables built for another machine:\n` +
      foreign.slice(0, 10).join('\n') + (foreign.length > 10 ? `\n… ${foreign.length - 10} more` : ''))
  }
}

export function isOfficialReleaseCacheValid(destination, target) {
  try {
    const artifact = officialDesktopArtifact(target)
    if (readFileSync(join(destination, 'receipt.json'), 'utf8') !== cacheIdentity(target, artifact)) return false
    const runtime = join(destination, 'runtime/primary-runtime')
    const [platform] = target.split('-')
    verifyOfficialRuntimeProvenance(runtime,target)
    const complete = [
      join(runtime, 'dependencies/python', platform === 'mac' ? 'bin/python3' : 'python.exe'),
      join(runtime, 'dependencies/node/bin', platform === 'mac' ? 'node' : 'node.exe'),
      join(runtime, 'dependencies/pnpm/bin/pnpm.cjs'),
      join(destination, 'runtime/cli/command-manager.js'),
      join(destination, 'runtime/office-skills'),
    ].every(existsSync)
    if (!complete) return false
    if (!artifact.composed) return true
    const metadata = JSON.parse(readFileSync(join(runtime, 'runtime.json'), 'utf8'))
    return metadata.payloadDigest === payloadDigest(runtime)
  } catch { return false }
}
export async function verifyArtifact(path, artifact) {
  const digest = createHash('sha512'); let size = 0
  for await (const chunk of createReadStream(path)) { size += chunk.length; digest.update(chunk) }
  if (size !== artifact.size || digest.digest('base64') !== artifact.sha512) throw new Error('Official Desktop release size or SHA-512 mismatch')
}
function findResources(directory, depth = 0) {
  if (existsSync(join(directory, 'runtime/primary-runtime/runtime.json'))) return directory
  if (depth > 8) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = findResources(join(directory, entry.name), depth + 1)
    if (found) return found
  }
}
function nestedArchive(directory, depth = 0) {
  if (depth > 5) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isFile() && /^app-.*\.7z$/.test(entry.name)) return path
    if (entry.isDirectory()) { const found = nestedArchive(path, depth + 1); if (found) return found }
  }
}
function extractArchive(archive, target, directory) {
  mkdirSync(directory, { recursive: true })
  if (target.startsWith('mac-')) execFileSync('/usr/bin/ditto', ['-x', '-k', archive, directory], { stdio: 'inherit' })
  else {
    const sevenZip = process.env.EPUBERDSH_7ZIP ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip/7z.exe')
    execFileSync(sevenZip, ['x', '-y', archive, '-o' + directory], { stdio: 'inherit' })
    const inner = nestedArchive(directory)
    if (inner) execFileSync(sevenZip, ['x', '-y', inner, '-o' + join(directory, 'application')], { stdio: 'inherit' })
  }
}
async function ensureArchive(cache, source) {
  const archive = process.env.EPUBERDSH_OFFICIAL_DESKTOP_ARCHIVE && source.role === 'official'
    ? resolve(process.env.EPUBERDSH_OFFICIAL_DESKTOP_ARCHIVE)
    : join(cache, new URL(source.url).pathname.split('/').at(-1))
  if (!existsSync(archive)) {
    const partial = archive + '.partial'
    const response = await fetch(source.url, { signal: AbortSignal.timeout(600_000) })
    if (!response.ok || !response.body) throw new Error('Official Desktop download failed: ' + response.status + ' ' + source.url)
    try { await pipeline(Readable.fromWeb(response.body), createWriteStream(partial)); await verifyArtifact(partial, source); renameSync(partial, archive) }
    finally { rmSync(partial, { force: true }) }
  }
  await verifyArtifact(archive, source)
  return archive
}

/**
 * Build a target the publisher has not released yet from two official archives:
 * the arch-independent runtime of the shipped version and the newest official
 * architecture binaries for this target. Every input is a locked, verified
 * archive; nothing is copied from a source checkout and nothing is relabelled.
 */
export function assembleComposedRuntime(sources, destination, target, artifact) {
  const [platform, arch] = target.split('-')
  const binaries = sources.find(entry => entry.source.role === 'binaries')?.resources
  const payload = sources.find(entry => entry.source.role === 'payload')?.resources
  if (binaries === undefined || payload === undefined) throw new Error('A composed target needs both a binaries and a payload source')
  const runtime = join(destination, 'runtime')
  const copy = (from, to) => copyOfficialRuntime(from, to)
  // Arch-independent payload: the official build of this exact DSH version.
  for (const name of ['cli', 'office-skills']) copy(join(payload, 'runtime', name), join(runtime, name))
  copy(join(payload, 'runtime/primary-runtime/dependencies/pnpm'), join(runtime, 'primary-runtime/dependencies/pnpm'))
  // Architecture-specific executables: the newest official build of this target.
  for (const name of ['node', 'python']) copy(join(binaries, 'runtime/primary-runtime/dependencies', name), join(runtime, 'primary-runtime/dependencies', name))
  // The command linker is a native helper inside the shared CLI tree, so it has
  // to come from the architecture build rather than from the shared payload.
  if (existsSync(join(binaries, 'runtime/cli/link-entry'))) copy(join(binaries, 'runtime/cli/link-entry'), join(runtime, 'cli/link-entry'))
  const declared = JSON.parse(readFileSync(join(payload, 'runtime/primary-runtime/runtime.json'), 'utf8'))
  const metadata = { ...declared, desktopVersion: artifact.version, platform: platform === 'mac' ? 'darwin' : 'win32', arch }
  const primary = join(runtime, 'primary-runtime')
  metadata.payloadDigest = payloadDigest(primary)
  assertOfficialPrimaryRuntime(metadata, target)
  writeFileSync(join(primary, 'runtime.json'), JSON.stringify(metadata, null, 2) + '\n')
  assertExecutableArchitecture(runtime, arch, platform)
}

export async function prepareOfficialRelease(desktopRoot, target) {
  const artifact = officialDesktopArtifact(target)
  const cache = join(desktopRoot, 'build/official-release-cache'); mkdirSync(cache, { recursive: true })
  const destination = join(cache, target + '-' + artifact.version)
  const receipt = join(destination, 'receipt.json')
  const identity = cacheIdentity(target, artifact)
  if (isOfficialReleaseCacheValid(destination, target)) return destination
  const temporary = mkdtempSync(join(cache, 'extract-'))
  try {
    const sources = []
    for (const source of artifact.sources) {
      const archive = await ensureArchive(cache, source)
      const directory = join(temporary, source.role)
      extractArchive(archive, source.target, directory)
      const resources = findResources(directory)
      if (!resources) throw new Error(`Official release has no reusable runtime resources: ${source.role}`)
      if (!existsSync(join(resources, 'runtime/cli/command-manager.js')) || !existsSync(join(resources, 'runtime/office-skills'))) {
        throw new Error(`Official release is missing command/Office resources: ${source.role}`)
      }
      sources.push({ source, resources })
    }
    rmSync(destination, { recursive: true, force: true }); mkdirSync(destination, { recursive: true })
    if (artifact.composed) assembleComposedRuntime(sources, destination, target, artifact)
    else {
      const [official] = sources
      // A verbatim target keeps the publisher's own metadata untouched.
      assertOfficialPrimaryRuntime(JSON.parse(readFileSync(join(official.resources, 'runtime/primary-runtime/runtime.json'), 'utf8')), target)
      for (const name of ['primary-runtime', 'office-skills', 'cli']) copyOfficialRuntime(join(official.resources, 'runtime', name), join(destination, 'runtime', name))
    }
    writeOfficialRuntimeProvenance(join(destination, 'runtime/primary-runtime'), target)
    writeFileSync(receipt, identity)
    if (!isOfficialReleaseCacheValid(destination, target)) throw new Error('Copied official runtime is incomplete or has broken executable links')
    return destination
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
