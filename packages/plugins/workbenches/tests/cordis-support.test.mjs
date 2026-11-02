import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
const bundle=async entry=>{
  const built=await build({entryPoints:[fileURLToPath(new URL(entry,import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const support=await bundle('../src/runtime/cordis-support.ts');
const starter=await bundle('../src/runtime/development-starter.ts');
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const installed=JSON.parse(await readFile(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'),'utf8')).version;
const {satisfies}=createRequire(new URL('../package.json',import.meta.url))('semver');

test('the SDK peer range states the Cordis generation the startup check verified', () => {
  assert.equal(support.CORDIS_PEER_RANGE, manifest.peerDependencies['@deepseek-ai/cordis'],
    'a Host upgrade must move the published peer and the startup check together');
  assert.ok(satisfies(installed, support.CORDIS_PEER_RANGE, {includePrerelease: true}),
    `installed Cordis ${installed} must satisfy the supported range ${support.CORDIS_PEER_RANGE}`);
});

test('generated starters declare the same range, never a stale literal', () => {
  const generated=starter.createWorkbenchStarter('probe-workbench',{id:'probe',title:'Probe',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]});
  assert.equal(generated.manifest.peerDependencies['@deepseek-ai/cordis'], support.CORDIS_PEER_RANGE);
});
