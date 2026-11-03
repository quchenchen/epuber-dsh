#!/usr/bin/env node
/**
 * Publish the bundled skills to a SkillHub namespace.
 *
 * The catalog and the shipped app must describe the same skills, and the only
 * way to guarantee that is to publish the same source directory the build ships
 * from. Publishing is content-addressed here: a skill whose files did not change
 * since the last successful publish is skipped, so repeated runs do not create a
 * version per invocation.
 *
 *   node scripts/publish-builtin-skills.mjs --registry http://127.0.0.1:8080 \
 *     --namespace epuberdsh [--token $SKILLHUB_TOKEN] [--only news-desk] [--dry-run]
 *
 * The upload itself goes through the SkillHub CLI: re-implementing its upload
 * protocol here would drift from the registry the moment it changes.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = join(pluginRoot, 'resources/skills');
const stateFile = join(pluginRoot, 'node_modules/.cache/skillhub-publish-state.json');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const registry = (argument('registry', process.env.SKILLHUB_URL) ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const namespace = argument('namespace', process.env.SKILLHUB_NAMESPACE) ?? 'epuberdsh';
const token = argument('token', process.env.SKILLHUB_TOKEN);
/** Team skills are internal by default; publishing them to the public catalog must be deliberate. */
const visibility = argument('visibility') ?? 'namespace-only';
const only = argument('only');
const dryRun = process.argv.includes('--dry-run');
/** The registry rate-limits publishing; a burst of 16 uploads trips it. */
const delayMs = Number(argument('delay', '1500'));
const maxAttempts = 4;

const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));

if (!token && !dryRun) {
  console.error('缺少令牌：用 --token 或环境变量 SKILLHUB_TOKEN 提供。');
  process.exit(1);
}

/** Stable fingerprint of one skill directory: relative path plus bytes, order-independent. */
async function fingerprint(directory) {
  const hash = createHash('sha256');
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) { hash.update(path.slice(directory.length + 1)); hash.update('\0'); hash.update(await readFile(path)); hash.update('\0'); }
    }
  };
  await walk(directory);
  return hash.digest('hex');
}

async function loadState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return {}; }
}

const state = await loadState();
const names = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => !only || name === only)
  .sort();

if (!names.length) {
  console.error(only ? `没有找到技能 ${only}` : '没有找到可发布的技能');
  process.exit(1);
}

let published = 0; let skipped = 0; const failures = [];
for (const name of names) {
  const directory = join(skillsRoot, name);
  const digest = await fingerprint(directory);
  const key = `${namespace}/${name}`;
  if (state[key]?.digest === digest) { console.log(`跳过 ${key}（内容未变）`); skipped += 1; continue; }
  if (dryRun) { console.log(`将发布 ${key}（dry-run）`); skipped += 1; continue; }

  let output = ''; let ok = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(process.env.SKILLHUB_CLI ?? 'skillhub', [
      'publish', directory, '--registry', registry, '--namespace', namespace, '--token', token,
      ...(visibility ? ['--visibility', visibility] : []),
    ], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
    output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.status === 0) { ok = true; break; }
    // Only back off for throttling; a rejected package will never succeed on retry.
    if (!/rate limit|429/iu.test(output)) break;
    const wait = attempt * 5_000;
    console.log(`限流，${wait / 1000}s 后重试 ${key}（第 ${attempt}/${maxAttempts} 次）`);
    await sleep(wait);
  }
  if (!ok) { failures.push({ name, output: output.split('\n').slice(0, 3).join(' ') }); continue; }
  const version = /@([0-9]+\.[0-9]+\.[0-9]+)/u.exec(output)?.[1];
  state[key] = { digest, version, publishedAt: new Date().toISOString() };
  published += 1;
  console.log(`已发布 ${key}${version ? `@${version}` : ''}`);
  await sleep(delayMs);
}

if (!dryRun) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

console.log(`\n合计 ${names.length}：发布 ${published}，跳过 ${skipped}，失败 ${failures.length}（${registry} · ${namespace}）`);
for (const failure of failures) console.error(`  失败 ${failure.name}: ${failure.output}`);
if (failures.length) process.exitCode = 1;
