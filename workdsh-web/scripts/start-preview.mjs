import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutRedundantAgentTeamProfile } from './preview-agent-team.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewHome = process.env.WORKDSH_PREVIEW_HOME ?? resolve(root, '.test-runtime/preview');
// NOTE: this keeps the user-level `~/.agents` home on purpose. AGENTS.md
// requires the manual 18989 preview to read the user's real skill directory
// and forbids judging "skills are lost" from an empty probe home. Upstream
// moved this default to `previewHome/agents` for fully isolated desktop
// runs; the WorkDSH web preview deliberately does not take that change.
const agentsHome = process.env.DSH_AGENTS_HOME ?? resolve(homedir(), '.agents');
// The skill catalog is environment data, not a build artifact: the skills
// plugin reads `$DSH_AGENTS_HOME/.workdsh-catalog` for marketplace display
// names and icons. Rebuild it from the local market mirror when it is absent,
// so skill cards keep their Chinese titles across agents-home resets.
const catalogDir = process.env.WORKDSH_SKILL_CATALOG ?? resolve(agentsHome, '.workdsh-catalog');
if (!existsSync(resolve(catalogDir, 'catalog.json'))) {
  const marketplace = process.env.WORKDSH_SKILL_MARKETPLACE ?? resolve(homedir(), '.workbuddy/skills-marketplace');
  if (existsSync(resolve(marketplace, '.codebuddy-skill/marketplace.json'))) {
    console.log(`Skill catalog missing; rebuilding from market mirror ${marketplace} …`);
    const rebuilt = spawnSync(process.execPath, [resolve(root, 'scripts/build-skill-catalog.mjs'), '--source', marketplace], { stdio: 'inherit' });
    if (rebuilt.status) throw new Error(`build-skill-catalog failed with exit ${rebuilt.status}.`);
  } else {
    console.log('Note: local skill catalog is absent and no market mirror was found; skill cards will show raw skill ids. Point WORKDSH_SKILL_MARKETPLACE at a mirror to build one.');
  }
}
const port = process.env.WORKDSH_PREVIEW_PORT ?? '18989';
// Preview currently needs a larger startup heap; this does not fix the underlying growth.
const heapMb = process.env.WORKDSH_PREVIEW_HEAP_MB ?? '8192';
if (!/^\d+$/.test(heapMb) || Number(heapMb) < 512) throw new Error('WORKDSH_PREVIEW_HEAP_MB must be an integer >= 512');
const profile = resolve(previewHome, 'profiles/preview');
const profileManifestPath = resolve(profile, 'package.json');
if (existsSync(profileManifestPath)) {
  const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'));
  const normalizedManifest = withoutRedundantAgentTeamProfile(profileManifest);
  if (normalizedManifest) {
    writeFileSync(profileManifestPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`);
    console.log('Removed redundant standalone Agent Team profile; WorkDSH experts owns Team composition.');
  }
}
const dsh = resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
// Fail before serving a broken UI if preview:install has not migrated the CLI.
const cliManifest = resolve(profile, 'node_modules/@deepseek-ai/dsh/package.json');
const expected = JSON.parse(readFileSync(resolve(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version;
let installed;
try { installed = JSON.parse(readFileSync(cliManifest, 'utf8')); }
catch { throw new Error('Preview runtime is missing. Run corepack pnpm preview:install first.'); }
if (installed.version !== expected) throw new Error('Preview runtime is out of date. Run corepack pnpm preview:install first.');
const profileRequire = createRequire(resolve(profile, 'package.json'));
const bootFor = (consumer) => realpathSync(createRequire(profileRequire.resolve(`${consumer}/package.json`)).resolve('@deepseek-ai/dsh-app-boot'));
if (bootFor('@deepseek-ai/dsh') !== bootFor('@deepseek-ai/dsh-config-editor')) {
  throw new Error('Preview runtime has split settings dependencies. Run corepack pnpm preview:install first.');
}

mkdirSync(previewHome, { recursive: true });
const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, dsh, '--profile', 'preview', '--host', '127.0.0.1', '--port', port, '--no-open'], {
  cwd: root,
  env: { ...process.env, DSH_HOME: previewHome, DSH_AGENTS_HOME: agentsHome },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
