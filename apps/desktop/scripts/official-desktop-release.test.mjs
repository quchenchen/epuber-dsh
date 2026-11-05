import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { copyOfficialRuntime, isOfficialReleaseCacheValid, verifyArtifact, lock, assembleComposedRuntime, payloadDigest, assertExecutableArchitecture } from './official-desktop-release.mjs'
import {OFFICIAL_PROVENANCE_FILE,createOfficialRuntimeProvenance,officialDesktopArtifact,writeOfficialRuntimeProvenance,verifyOfficialRuntimeProvenance} from './official-runtime-provenance.mjs'

test('both runtime copies preserve relative executable links after their sources are removed', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'epuberdsh runtime links '))
  try {
    const source = join(directory, 'extracted'), cache = join(directory, 'cache'), prepared = join(directory, 'prepared')
    const bin = join('dependencies', 'python', 'bin')
    mkdirSync(join(source, bin), { recursive: true })
    writeFileSync(join(source, bin, 'python3.12'), 'bundled Python')
    symlinkSync('python3.12', join(source, bin, 'python3'))
    copyOfficialRuntime(source, cache)
    // An existing output from the old copier must also be repaired on rerun.
    mkdirSync(join(prepared, bin), { recursive: true })
    symlinkSync(join(source, bin, 'python3.12'), join(prepared, bin, 'python3'))
    copyOfficialRuntime(cache, prepared)
    rmSync(source, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
    assert.equal(readlinkSync(join(prepared, bin, 'python3')), 'python3.12')
    assert.equal(readFileSync(join(prepared, bin, 'python3'), 'utf8'), 'bundled Python')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('cache reuse rejects the previous copy format and missing executable targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'epuberdsh-runtime-cache-'))
  try {
    const target = 'mac-arm64', runtime = join(directory, 'runtime/primary-runtime')
    const write = (path, value = 'fixture') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
    write(join(runtime, 'runtime.json'), JSON.stringify({ desktopVersion: lock.desktopArtifacts[target].version, platform: 'darwin', arch: 'arm64', ...lock.primaryRuntime,payloadDigest:'a'.repeat(64) }))
    const executable = join(runtime, 'dependencies/python/bin/python3')
    const executableTarget = process.platform === 'win32' ? executable : join(runtime, 'dependencies/python/bin/python3.12')
    for (const path of [executableTarget, join(runtime, 'dependencies/node/bin/node'), join(runtime, 'dependencies/pnpm/bin/pnpm.cjs'), join(directory, 'runtime/cli/command-manager.js')]) write(path)
    if (process.platform !== 'win32') symlinkSync('python3.12', executable)
    mkdirSync(join(directory, 'runtime/office-skills'))
    const identity = { npmDshVersion: lock.version, target, artifact: officialDesktopArtifact(target) }
    write(join(directory, 'receipt.json'), JSON.stringify(identity))
    assert.equal(isOfficialReleaseCacheValid(directory, target), false, 'old absolute-link copies must be rebuilt')
    write(join(directory, 'receipt.json'), JSON.stringify({ copyFormat: 3, ...identity }))
    assert.equal(isOfficialReleaseCacheValid(directory, target), false, 'a cache cannot claim unrecorded binary provenance')
    writeOfficialRuntimeProvenance(runtime,target)
    assert.equal(isOfficialReleaseCacheValid(directory, target), true)
    unlinkSync(executableTarget)
    assert.equal(isOfficialReleaseCacheValid(directory, target), false)
    assert.equal(existsSync(join(runtime, 'runtime.json')), true, 'a receipt and metadata alone do not establish a usable cache')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('official binary archives require both the locked size and content digest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'epuberdsh-release-hash-'))
  try {
    const file = join(directory, 'release.zip'), bytes = Buffer.from('official candidate')
    writeFileSync(file, bytes)
    const artifact = { size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }
    await verifyArtifact(file, artifact)
    await assert.rejects(verifyArtifact(file, { ...artifact, size: bytes.length + 1 }), /mismatch/)
    writeFileSync(file, Buffer.from('modified candidate'))
    await assert.rejects(verifyArtifact(file, artifact), /mismatch/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('every supported target pins immutable official archives with full digests', () => {
  assert.equal(lock.distribution, 'published-packages-and-desktop-release')
  for (const target of ['mac-arm64', 'mac-x64', 'win-x64']) {
    const artifact = officialDesktopArtifact(target)
    assert.equal(artifact.version, lock.version, 'every shipped target runs the packaged version')
    assert.ok(artifact.sources.length > 0)
    for (const source of artifact.sources) {
      assert.equal(new URL(source.url).hostname, 'download.deepseek.com')
      assert.ok(source.url.includes('deepseek-harness-' + source.version + '-' + source.target), 'each archive is pinned to its own version and target')
      assert.equal(Buffer.from(source.sha512, 'base64').length, 64)
      assert.ok(source.size > 0)
    }
  }
})

test('Intel composes the packaged version from official components instead of shipping an older host',()=>{
  const directory=mkdtempSync(join(tmpdir(),'epuberdsh-intel-source-'))
  try{
    const target='mac-x64',artifact=officialDesktopArtifact(target)
    const [binaries,payload]=artifact.sources
    assert.equal(artifact.composed,true,'Intel has no published build of this version, so it is composed')
    assert.equal(artifact.version,lock.version,'the composed target runs the packaged version')
    assert.equal(payload.version,lock.version,'the arch-independent payload comes from the shipped version')
    assert.notEqual(binaries.version,lock.version,'the published Intel build predates this version; that is why composition exists')
    assert.equal(binaries.target,target,'architecture binaries come from the same target')
    const original=JSON.stringify({desktopVersion:artifact.version,platform:'darwin',arch:'x64',...lock.primaryRuntime,payloadDigest:'b'.repeat(64)})+'\n'
    writeFileSync(join(directory,'runtime.json'),original)
    const receipt=writeOfficialRuntimeProvenance(directory,target)
    assert.equal(receipt.schemaVersion,2)
    assert.deepEqual(receipt.artifact,artifact)
    assert.deepEqual(receipt.artifact.sources,[binaries,payload],'both source archives stay in the receipt')
    assert.deepEqual(verifyOfficialRuntimeProvenance(directory,target),receipt)
    for(const key of ['version','url','sha512','size']){
      const tampered=structuredClone(receipt)
      tampered.artifact.sources[0][key]=key==='size'?binaries.size+1:'tampered'
      writeFileSync(join(directory,OFFICIAL_PROVENANCE_FILE),JSON.stringify(tampered))
      assert.throws(()=>verifyOfficialRuntimeProvenance(directory,target),/provenance mismatch/,'a swapped source archive is detected')
    }
    writeFileSync(join(directory,OFFICIAL_PROVENANCE_FILE),JSON.stringify(receipt))
    writeFileSync(join(directory,'runtime.json'),original.replace(lock.version,binaries.version))
    assert.throws(()=>verifyOfficialRuntimeProvenance(directory,target),/metadata does not match/,'a composed runtime cannot claim the older build')
  }finally{rmSync(directory,{recursive:true,force:true})}
})

test('a composed runtime keeps the shipped payload and the target architecture binaries apart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'epuberdsh-compose-'))
  try{
    const write=(path,value='fixture')=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value)}
    const binaries=join(directory,'binaries'),payload=join(directory,'payload')
    write(join(binaries,'runtime/primary-runtime/runtime.json'),JSON.stringify({desktopVersion:'0.2.1-rc.4',platform:'darwin',arch:'x64',...lock.primaryRuntime,payloadDigest:'c'.repeat(64)}))
    write(join(binaries,'runtime/primary-runtime/dependencies/node/bin/node'),'x64 node')
    write(join(binaries,'runtime/primary-runtime/dependencies/python/bin/python3.12'),'x64 python')
    write(join(binaries,'runtime/cli/link-entry'),'x64 linker')
    write(join(payload,'runtime/primary-runtime/runtime.json'),JSON.stringify({desktopVersion:lock.version,platform:'darwin',arch:'arm64',...lock.primaryRuntime,payloadDigest:'d'.repeat(64)}))
    write(join(payload,'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs'),'pnpm 11.28.5')
    write(join(payload,'runtime/cli/command-manager.js'),'new command manager')
    write(join(payload,'runtime/cli/link-entry'),'arm64 linker')
    write(join(payload,'runtime/office-skills/skill.md'),'new office skills')
    const artifact=officialDesktopArtifact('mac-x64'),destination=join(directory,'composed')
    assembleComposedRuntime([{source:artifact.sources[0],resources:binaries},{source:artifact.sources[1],resources:payload}],destination,'mac-x64',artifact)
    const runtime=join(destination,'runtime')
    const read=path=>readFileSync(join(runtime,path),'utf8')
    assert.equal(read('primary-runtime/dependencies/node/bin/node'),'x64 node','binaries follow the target architecture')
    assert.equal(read('primary-runtime/dependencies/python/bin/python3.12'),'x64 python')
    assert.equal(read('cli/link-entry'),'x64 linker','the native command linker follows the target architecture')
    assert.equal(read('primary-runtime/dependencies/pnpm/bin/pnpm.cjs'),'pnpm 11.28.5','the package manager comes from the shipped version')
    assert.equal(read('cli/command-manager.js'),'new command manager')
    assert.equal(read('office-skills/skill.md'),'new office skills')
    const metadata=JSON.parse(read('primary-runtime/runtime.json'))
    assert.equal(metadata.desktopVersion,lock.version)
    assert.equal(metadata.arch,'x64')
    assert.equal(metadata.payloadDigest,payloadDigest(join(runtime,'primary-runtime')),'the digest describes the assembled payload')
    writeOfficialRuntimeProvenance(join(runtime,'primary-runtime'),'mac-x64')
    assert.doesNotThrow(()=>verifyOfficialRuntimeProvenance(join(runtime,'primary-runtime'),'mac-x64'))
  }finally{rmSync(directory,{recursive:true,force:true})}
})

test('composition refuses guessed versions, foreign payloads and pointless composition',()=>{
  const variant=change=>{const changed=structuredClone(lock);change(changed);return changed}
  for(const replacement of [undefined,'^0.2.1','0.0.0-guess']){
    assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{l.desktopArtifacts['mac-x64'].version=replacement})),/locked|invalid|compose/i)
  }
  assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{l.desktopArtifacts['mac-x64'].composed.binaries.url=l.desktopArtifacts['mac-arm64'].url})),/invalid/)
  assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{
    l.desktopArtifacts['mac-x64'].composed.binaries.target='mac-arm64'
    l.desktopArtifacts['mac-x64'].composed.binaries.url='https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.4-mac-arm64.zip'
  })),/architecture binaries/)
  assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{
    l.desktopArtifacts['mac-x64'].composed.payload.target='win-x64'
    l.desktopArtifacts['mac-x64'].composed.payload.url='https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe'
  })),/cannot reuse/)
  assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{
    l.desktopArtifacts['mac-x64'].composed.payload.version='0.2.1-rc.4'
    l.desktopArtifacts['mac-x64'].composed.payload.url='https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.4-mac-arm64.zip'
  })),/payload from/)
  assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{
    l.desktopArtifacts['mac-x64'].composed.binaries.version='0.2.2-rc.1'
    l.desktopArtifacts['mac-x64'].composed.binaries.url='https://download.deepseek.com/dsh-desk/bin/mac-x64/deepseek-harness-0.2.2-rc.1-mac-x64.zip'
  })),/official 0\.2\.2-rc\.1 build/)
  assert.throws(()=>officialDesktopArtifact('mac-x64',variant(l=>{
    l.desktopArtifacts['mac-x64']={...l.desktopArtifacts['mac-x64'],version:'0.2.1-rc.4'}
  })),/compose it from 0\.2\.2-rc\.1/, 'a stale lock is never silently shipped')
})

test('the architecture guard judges load-bearing trees and ignores cross-platform prebuilds',()=>{
  const directory=mkdtempSync(join(tmpdir(),'epuberdsh-arch-guard-'))
  try{
    const macho=cpu=>{const bytes=Buffer.alloc(32);bytes.writeUInt32LE(0xfeedfacf,0);bytes.writeUInt32LE(cpu,4);return bytes}
    const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value)}
    const runtime=join(directory,'runtime')
    write(join(runtime,'primary-runtime/dependencies/node/bin/node'),macho(0x01000007))
    // pnpm ships every platform's prebuild and picks one at run time, so an
    // arm64 reflink inside an x64 runtime is expected, not a defect.
    write(join(runtime,'primary-runtime/dependencies/pnpm/dist/node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node'),macho(0x0100000c))
    assert.doesNotThrow(()=>assertExecutableArchitecture(runtime,'x64','mac'))
    write(join(runtime,'primary-runtime/dependencies/node/bin/node'),macho(0x0100000c))
    assert.throws(()=>assertExecutableArchitecture(runtime,'x64','mac'),/built for another machine/,'the interpreter must match the target')
  }finally{rmSync(directory,{recursive:true,force:true})}
})
