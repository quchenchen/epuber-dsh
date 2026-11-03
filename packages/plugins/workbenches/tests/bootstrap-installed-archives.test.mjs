import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';import {tmpdir} from 'node:os';import {join} from 'node:path';
// Build the same ustar shape npm publishes, without depending on a platform tar.
function ustar(files) {
 const blocks=[];
 for (const [name,text] of Object.entries(files)) {
  const data=Buffer.from(text,'utf8'),header=Buffer.alloc(512);
  header.write(name,0,100,'utf8');
  header.write('0000644\0',100,8,'ascii');header.write('0000000\0',108,8,'ascii');header.write('0000000\0',116,8,'ascii');
  header.write(data.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');
  header.write(Math.floor(Date.parse('2026-01-01T00:00:00Z')/1000).toString(8).padStart(11,'0')+'\0',136,12,'ascii');
  header.write('        ',148,8,'ascii');header.write('0',156,1,'ascii');header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');
  let sum=0;for(const byte of header)sum+=byte;
  header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  blocks.push(header,data,Buffer.alloc((512-data.length%512)%512));
 }
 blocks.push(Buffer.alloc(1024));
 return gzipSync(Buffer.concat(blocks));
}
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/bootstrap-installed-archives.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {bootstrapInstalledWorkbenchArchives:seed}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('bootstrap does not adopt outside paths or unverified bytes',async()=>{const root=await realpath(await mkdtemp(join(tmpdir(),'epuberdsh-bootstrap-')));let retained=0;const store={resolve:()=>{throw Error('workbench/installation-archive-unavailable');},retainVerified:async()=>{retained++;}};const directory=join(root,'epuberdsh-bootstrap-archives');try{await seed(root,store,()=>{});await mkdir(directory);const row={fileName:'../outside.tgz',packageName:'example',version:'1.0.0',workbenchId:'probe.example',sha256:'a'.repeat(64)};const index=join(directory,'index.json');await writeFile(index,JSON.stringify({version:1,entries:[row]}));await assert.rejects(seed(root,store,()=>{}),/invalid-bootstrap-index/);row.fileName='bad.tgz';await writeFile(join(directory,row.fileName),'not a package');await writeFile(index,JSON.stringify({version:1,entries:[row]}));await assert.rejects(seed(root,store,()=>{}));await assert.rejects(seed(root,store,()=>{throw Error('revoked');}),/revoked/);assert.equal(retained,0);await rm(index);await writeFile(join(root,'outside.json'),JSON.stringify({version:1,entries:[]}));await symlink(join(root,'outside.json'),index);await assert.rejects(seed(root,store,()=>{}),/invalid-bootstrap-index/);}finally{await rm(root,{recursive:true,force:true});}});

test('an obsolete bootstrap seed cannot block the updated Profile or certify its new bytes',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'epuberdsh-bootstrap-updated-')));
 try{
  const directory=join(root,'epuberdsh-bootstrap-archives');await mkdir(directory);await mkdir(join(root,'node_modules/example'),{recursive:true});
  await writeFile(join(root,'node_modules/example/package.json'),JSON.stringify({name:'example',version:'2.0.0',epuberdsh:{workbench:{id:'probe.example',title:'Updated',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]}}}));
  await writeFile(join(directory,'index.json'),JSON.stringify({version:1,entries:[{fileName:'old.tgz',packageName:'example',version:'1.0.0',workbenchId:'probe.example',sha256:'a'.repeat(64)}]}));
  let retained=0;await seed(root,{resolve(){throw Error('must-not-resolve-old');},async retainVerified(){retained++;}},()=>{});assert.equal(retained,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an in-place upgrade supersedes the stale retained archive instead of blocking activation', async () => {
 const root=await realpath(await mkdtemp(join(tmpdir(),'epuberdsh-bootstrap-upgrade-')));
 try{
  const directory=join(root,'epuberdsh-bootstrap-archives'),stage=join(root,'stage'),seedPath=join(directory,'seed.tgz');
  const manifest={name:'example',version:'2.0.0',epuberdsh:{workbench:{id:'probe.example',title:'Updated',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]}}};
  const script='console.log("upgraded");\n';
  await mkdir(join(stage,'package/dist'),{recursive:true});await mkdir(directory,{recursive:true});
  await mkdir(join(root,'node_modules/example/dist'),{recursive:true});
  await writeFile(join(stage,'package/package.json'),JSON.stringify(manifest));
  await writeFile(join(stage,'package/dist/index.js'),script);
  await writeFile(join(root,'node_modules/example/package.json'),JSON.stringify(manifest));
  await writeFile(join(root,'node_modules/example/dist/index.js'),script);
  const archive=ustar({'package/package.json':JSON.stringify(manifest),'package/dist/index.js':script});
  await writeFile(seedPath,archive);
  const sha256=createHash('sha256').update(archive).digest('hex');
  await writeFile(join(directory,'index.json'),JSON.stringify({version:1,entries:[{fileName:'seed.tgz',packageName:'example',version:'2.0.0',workbenchId:'probe.example',sha256}]}));
  let retained=0,superseded;
  const result=await seed(root,{
   resolve(){return {path:join(root,'stale.tgz'),sha256:'b'.repeat(64),workbenchId:'probe.example'};},
   async retainVerified(){retained++;throw Error('workbench/installed-file-mismatch');},
   async supersedeVerified(input){superseded=input;}
  },()=>{});
  assert.equal(retained,1,'the retained receipt is still tried first');
  assert.equal(superseded?.sha256,sha256,'the inspected seed supersedes the stale receipt');
  assert.equal(superseded?.workbenchId,'probe.example');
  assert.equal(result,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a stale receipt is not replaced by an archive that cannot certify the installed bytes', async () => {
 const root=await realpath(await mkdtemp(join(tmpdir(),'epuberdsh-bootstrap-nonmatch-')));
 try{
  const directory=join(root,'epuberdsh-bootstrap-archives'),stage=join(root,'stage');
  const manifest={name:'example',version:'2.0.0',epuberdsh:{workbench:{id:'probe.example',title:'Updated',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]}}};
  await mkdir(join(stage,'package/dist'),{recursive:true});await mkdir(directory,{recursive:true});
  await mkdir(join(root,'node_modules/example/dist'),{recursive:true});
  await writeFile(join(stage,'package/package.json'),JSON.stringify(manifest));
  await writeFile(join(stage,'package/dist/index.js'),'console.log("seed");\n');
  await writeFile(join(root,'node_modules/example/package.json'),JSON.stringify(manifest));
  await writeFile(join(root,'node_modules/example/dist/index.js'),'console.log("tampered");\n');
  const archive=ustar({'package/package.json':JSON.stringify(manifest),'package/dist/index.js':'console.log("seed");\n'});
  await writeFile(join(directory,'seed.tgz'),archive);
  const sha256=createHash('sha256').update(archive).digest('hex');
  await writeFile(join(directory,'index.json'),JSON.stringify({version:1,entries:[{fileName:'seed.tgz',packageName:'example',version:'2.0.0',workbenchId:'probe.example',sha256}]}));
  let superseded=0;
  await assert.rejects(seed(root,{
   resolve(){return {path:join(root,'stale.tgz'),sha256:'b'.repeat(64),workbenchId:'probe.example'};},
   async retainVerified(){throw Error('workbench/installed-file-mismatch');},
   async supersedeVerified(){superseded++;throw Error('workbench/installed-file-mismatch');}
  },()=>{}),/workbench\/installed-file-mismatch/);
  assert.equal(superseded,1,'bytes that match neither receipt may not become an accepted archive');
 }finally{await rm(root,{recursive:true,force:true});}
});
