import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION } from '../apps/desktop/scripts/runtime-version.mjs'
import {officialDesktopArtifact} from '../apps/desktop/scripts/official-runtime-provenance.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const upstream = readJson('upstream.json')
const problems = []
if (upstream.desktopArtifactVersion !== undefined) problems.push('Binary artifact versions must be explicitly locked per target, not hidden behind a global desktopArtifactVersion')
if (upstream.version !== DSH_VERSION || upstream.distribution !== 'published-packages-and-desktop-release') problems.push('Desktop must consume the locked official release version')
// One version everywhere: a shipped target runs exactly the DSH build its npm
// packages are. A target the publisher has not built yet is composed from
// official components of that same version, never held back and never paired
// with an older host.
const targets = ['mac-arm64', 'mac-x64', 'win-x64']
const resolved = []
for (const target of targets) {
  try { resolved.push([target, officialDesktopArtifact(target, upstream)]) }
  catch (error) { problems.push(error instanceof Error ? error.message : String(error)) }
}
for (const [target, artifact] of resolved) {
  if (artifact.version !== upstream.version) problems.push(`Target ${target} would ship DSH ${upstream.version} packages on a ${artifact.version} runtime`)
  if (!artifact.composed) continue
  const [binaries, payload] = artifact.sources
  if (payload.version !== upstream.version) problems.push(`Target ${target} must compose its runtime payload from ${upstream.version}, not ${payload.version}`)
  if (binaries.target !== target) problems.push(`Target ${target} must take its architecture binaries from ${target}, not ${binaries.target}`)
}
for (const workspace of ['apps/desktop']) {
  const manifest = readJson(`${workspace}/package.json`)
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
        problems.push(`${workspace} declares an extra DSH package in ${field}: ${name}`)
      }
    }
  }
}
for (const name of Object.keys(readJson('package.json').resolutions ?? {})) {
  if (name.startsWith('@deepseek-ai/dsh')) problems.push(`root resolution retains old DSH package: ${name}`)
}

if (problems.length) {
  console.error(`Desktop DSH version alignment failed:\n${problems.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Desktop has one npm DSH version ${DSH_VERSION}; runtime sources: ` + resolved.map(([target, artifact]) =>
    artifact.composed
      ? `${target}=${artifact.version} (composed: payload ${artifact.sources[1].version} + ${target} binaries ${artifact.sources[0].version})`
      : `${target}=${artifact.version} (official)`
  ).join(', '))
}
