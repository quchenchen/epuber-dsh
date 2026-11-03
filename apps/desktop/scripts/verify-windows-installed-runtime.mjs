#!/usr/bin/env node
/**
 * Install the built NSIS package the way a user does, then prove the installed
 * runtime still starts. Packaging verification used to stop at `win-unpacked`,
 * which never exercises the 7-Zip payload: that payload is exactly where a
 * symlinked Profile loses the links a package resolves its dependencies
 * through, so a green build could still fail on a user's machine with
 * "Cannot find package '@deepseek-ai/cosmokit'".
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(desktopRoot, 'dist')
const WINDOWS_LIMIT = 260
const REQUIRED_IDS = ['skillhub', 'dsh-market', 'epuberdsh-installation-probe', 'epuberdsh-identity-local', 'epuberdsh-access', 'epuberdsh-audit', 'epuberdsh-workbenches']

if (process.platform !== 'win32') {
  console.log('Windows installed-runtime verification is only meaningful on Windows; skipped')
  process.exit(0)
}

const installer = readdirSync(dist)
  .filter(name => name.toLowerCase().endsWith('.exe') && name.toLowerCase().includes('setup'))
  .map(name => join(dist, name))[0]
if (installer === undefined) throw new Error('No Windows Setup package found in ' + dist)

/** @param {string} command @param {readonly string[]} args */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 1_800_000, ...options })
  if (result.error) throw result.error
  return result
}

const target = mkdtempSync(join(tmpdir(), 'epuberdsh-installed-'))
// A fresh directory keeps the check honest: an upgrade would leave files behind.
rmSync(target, { recursive: true, force: true })
console.log('Installing ' + installer + ' into ' + target)
// NSIS requires /D= last, unquoted, and accepts it only for a clean directory.
const install = run(installer, ['/S', '/D=' + target])
if (install.status !== 0) throw new Error('Silent install exited with ' + install.status)
// The installer may hand off to a detached process; stop it before inspecting.
run('taskkill', ['/F', '/IM', 'EpuberDSH.exe'], { stdio: 'ignore' })

const profile = join(target, 'resources', 'epuberdsh-runtime', 'profiles', 'epuberdsh')
const runtime = join(target, 'resources', 'epuberdsh-runtime')
const node = join(runtime, 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe')
const cli = join(profile, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
for (const required of [profile, node, cli]) {
  if (!existsSync(required)) throw new Error('Installed package is incomplete; missing ' + required)
}

// A user installs under %LOCALAPPDATA%\Programs\EpuberDSH, which is shorter
// than the temp directory used here, so budgets are measured from the install
// root and re-based onto a documented worst-case production prefix.
const INSTALL_PREFIX = 60
const RUNTIME_FILE = /\.(?:js|mjs|cjs|json|node|wasm)$/iu
let links = 0, longest = 0, longestPath = '', deepestRuntime = 0, deepestRuntimePath = '', files = 0
const walk = directory => {
  for (const entry of readdirSync(directory)) {
    // Executable shims are never imported by the runtime; only dependency
    // links decide whether the installed profile can resolve its packages.
    if (entry === '.bin') continue
    const path = join(directory, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) { links++; continue }
    if (stat.isDirectory()) { walk(path); continue }
    files++
    const relative = path.length - target.length
    if (relative > longest) { longest = relative; longestPath = path }
    if (RUNTIME_FILE.test(entry) && relative > deepestRuntime) { deepestRuntime = relative; deepestRuntimePath = path }
  }
}
walk(profile)

const problems = []
if (links > 0) problems.push(links + ' links survived installation; the payload cannot carry the Profile symlink graph')
// Only modules decide whether the installed app can start. Documentation and
// source maps may legitimately sit near the limit and are never imported.
if (INSTALL_PREFIX + deepestRuntime >= WINDOWS_LIMIT) {
  problems.push('deepest runtime file would be ' + (INSTALL_PREFIX + deepestRuntime) + ' characters under a production install, at or past the ' + WINDOWS_LIMIT + '-character limit: ' + deepestRuntimePath)
}

const composition = run(node, [cli, '--profile', 'epuberdsh', '--dump-config'], {
  stdio: 'pipe',
  cwd: runtime,
  encoding: 'utf8',
  timeout: 600_000,
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, DSH_HOME: runtime, DSH_BUNDLED_PRIMARY_RUNTIME: join(runtime, 'primary-runtime') },
})
if (composition.status !== 0) problems.push('installed runtime did not compose: ' + String(composition.stderr ?? '').trim().split('\n').slice(-4).join(' | '))
const stdout = String(composition.stdout ?? '')
for (const id of REQUIRED_IDS) if (!stdout.includes('id: ' + id)) problems.push('installed runtime lost required component: ' + id)

console.log('Installed Profile: ' + files + ' files, ' + links + ' links, deepest runtime file ' + (INSTALL_PREFIX + deepestRuntime) + ' characters and deepest path ' + (INSTALL_PREFIX + longest) + ' characters in production (limit ' + WINDOWS_LIMIT + ')')
if (INSTALL_PREFIX + longest >= WINDOWS_LIMIT) console.log('Deepest entry is ' + longestPath + '; it is data, not a module')

if (problems.length) {
  for (const problem of problems) console.error('FAIL ' + problem)
  const log = join(target, 'runtime-failure.log')
  if (existsSync(log)) console.error(readFileSync(log, 'utf8').slice(-4000))
  throw new Error('Installed Windows runtime is not usable (' + problems.length + ' problems)')
}
console.log('Installed Windows runtime composes and starts')
