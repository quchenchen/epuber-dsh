/** Binary-tool provenance is independent of the one npm Host/Client version. */
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {isDeepStrictEqual} from 'node:util'

export const officialRuntimeLock=JSON.parse(readFileSync(new URL('../../../upstream.json',import.meta.url),'utf8'))
export const OFFICIAL_PROVENANCE_FILE='.epuberdsh-source-artifact.json'
const exactVersion=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const TARGETS=['mac-arm64','mac-x64','win-x64']

/** Lock one archive. Its URL is derived from its own target and version, so a
 * hand-edited URL can never point a target at another platform's build. */
function lockedArchive(target,entry,label){
 if(!entry||!TARGETS.includes(target)||!exactVersion.test(entry.version??''))throw Error('Official binary artifact target/version is not explicitly locked: '+label)
 const expected=`https://download.deepseek.com/dsh-desk/bin/${target}/deepseek-harness-${entry.version}-${target}.${target==='win-x64'?'exe':'zip'}`
 if(entry.url!==expected||!Number.isSafeInteger(entry.size)||entry.size<=0||
  !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512??'')||Buffer.from(entry.sha512,'base64').length!==64)
  throw Error('Official binary artifact URL/size/SHA-512 lock is invalid: '+label)
 return {target,version:entry.version,url:entry.url,size:entry.size,sha512:entry.sha512}
}

export function officialDesktopArtifact(target,lock=officialRuntimeLock){
 if(!TARGETS.includes(target)||lock.distribution!=='published-packages-and-desktop-release'||
  !exactVersion.test(lock.version??''))throw Error('Official binary artifact target/version is not explicitly locked: '+target)
 const entry=lock.desktopArtifacts?.[target]
 if(!entry||!exactVersion.test(entry.version??''))throw Error('Official binary artifact target/version is not explicitly locked: '+target)
 // A shipped target always runs the packaged version. Anything else is either a
 // stale lock or a silent downgrade, never a release.
 if(entry.version!==lock.version)throw Error(`Target ${target} locks Desktop ${entry.version} while the packages are ${lock.version}: compose it from ${lock.version} runtime components instead of pairing two versions`)
 if(entry.composed===undefined)
  return {version:entry.version,composed:false,sources:[{...lockedArchive(target,entry,target),role:'official'}]}
 const binaries={...lockedArchive(entry.composed?.binaries?.target,entry.composed?.binaries,`${target} binaries`),role:'binaries'}
 const payload={...lockedArchive(entry.composed?.payload?.target,entry.composed?.payload,`${target} payload`),role:'payload'}
 // Architecture-specific executables must come from the target itself, the
 // arch-independent payload from the shipped version, and both from one platform.
 if(binaries.target!==target)throw Error(`Target ${target} must take its architecture binaries from ${target}, not from ${binaries.target}`)
 if(payload.target.split('-')[0]!==target.split('-')[0])throw Error(`Target ${target} cannot reuse a runtime payload built for ${payload.target}`)
 if(payload.version!==entry.version)throw Error(`Target ${target} must take its runtime payload from ${entry.version}, not from ${payload.version}`)
 if(binaries.version===entry.version)throw Error(`Target ${target} already has an official ${entry.version} build: use that artifact instead of composing one`)
 return {version:entry.version,composed:true,sources:[binaries,payload]}
}

export function assertOfficialPrimaryRuntime(metadata,target,lock=officialRuntimeLock){
 const artifact=officialDesktopArtifact(target,lock),[platform,arch]=target.split('-')
 if(!metadata||metadata.desktopVersion!==artifact.version||metadata.platform!==(platform==='mac'?'darwin':'win32')||metadata.arch!==arch||
  !['node','pnpm','python'].every(name=>/^\d+\.\d+\.\d+$/.test(lock.primaryRuntime?.[name]??'')&&metadata[name]===lock.primaryRuntime[name])||
  !/^[a-f0-9]{64}$/.test(metadata.payloadDigest??''))throw Error('Official primary runtime metadata does not match the locked binary source: '+target)
 return metadata
}
export function createOfficialRuntimeProvenance(metadataBytes,target,lock=officialRuntimeLock){
 const bytes=Buffer.from(metadataBytes)
 assertOfficialPrimaryRuntime(JSON.parse(bytes.toString('utf8')),target,lock)
 return {schemaVersion:2,npmDshVersion:lock.version,target,artifact:officialDesktopArtifact(target,lock),
  runtimeMetadataSha256:createHash('sha256').update(bytes).digest('hex')}
}
/** Preserve upstream runtime.json verbatim; this separate record is owned.
 * A composed target has no upstream metadata to preserve: its runtime.json is
 * written from the locked versions plus the payload digest, and the receipt
 * records both archives it was assembled from. */
export function writeOfficialRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 const receipt=createOfficialRuntimeProvenance(readFileSync(join(primary,'runtime.json')),target,lock)
 writeFileSync(join(primary,OFFICIAL_PROVENANCE_FILE),JSON.stringify(receipt,null,2)+'\n')
 return receipt
}
export function verifyOfficialRuntimeProvenance(primary,target,lock=officialRuntimeLock){
 const expected=createOfficialRuntimeProvenance(readFileSync(join(primary,'runtime.json')),target,lock)
 const actual=JSON.parse(readFileSync(join(primary,OFFICIAL_PROVENANCE_FILE),'utf8'))
 if(!isDeepStrictEqual(actual,expected))throw Error('Official binary resource provenance mismatch: '+target)
 return expected
}
