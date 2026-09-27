#!/usr/bin/env node
// Build the WorkDSH-owned local skill catalog from a WorkBuddy/SkillHub mirror.
//
// The catalog is data, not code: metadata (title, category, icon) plus inert
// payload copies that the skills plugin installs through its existing import
// path. Source layout is the local marketplace mirror:
//   <source>/.codebuddy-skill/marketplace.json   (skills[] with name/source/tags)
//   <source>/icons/<skill>.(svg|png)             (optional brand icon)
//   <source>/skills/<source>/SKILL.md            (payload)
//
// Scenario scoping keeps the marketplace to the scenarios this product serves:
//   scripts/skill-scenario-policy.json assigns every mirrored skill to a scenario
//   (content/office/platform/dev/overseas/personal) and defines named scopes.
//   The default scope drops dev/overseas/personal entries from the catalog; the
//   mirror itself is never modified, so any of them can be restored by rebuilding
//   with --scope all.
//
// Usage:
//   node scripts/build-skill-catalog.mjs --source /path/to/skills-marketplace
//   node scripts/build-skill-catalog.mjs --source ... --target ~/.dsh/agents/.workdsh-catalog --dry-run
//   node scripts/build-skill-catalog.mjs --source ... --scope all     # 不做场景过滤
//   node scripts/build-skill-catalog.mjs --source ... --policy none   # 忽略策略文件
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('yaml', { paths: [join(root, 'packages/plugins/skills')] }));

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCHEMA = 1;
const MAX_FILES = 400;      // mirrors SkillImportStaging / installImportTree limits
const MAX_DEPTH = 6;
const MAX_BYTES = 50 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '__MACOSX']);
const SKIP_FILES = new Set(['.DS_Store']);
const SKIP_EXTENSIONS = new Set(['.zip', '.tgz', '.tar', '.gz']);
// Icons whose stem differs from the mirror directory and the skill name.
const ICON_ALIASES = { chuangye: 'the-entrepreneurship-handbook' };
// Icon stems that cover a skill family by name prefix.
const ICON_PREFIXES = ['minimax'];
const DEFAULT_POLICY = join(root, 'scripts', 'skill-scenario-policy.json');

function parseArguments(argv) {
  const options = { source: '', target: process.env.WORKDSH_SKILL_CATALOG ?? '', policy: DEFAULT_POLICY, scope: '', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--source') options.source = argv[++index] ?? '';
    else if (current === '--target') options.target = argv[++index] ?? '';
    else if (current === '--policy') options.policy = argv[++index] ?? '';
    else if (current === '--scope') options.scope = argv[++index] ?? '';
    else if (current === '--all') options.scope = 'all';
    else if (current === '--dry-run') options.dryRun = true;
    else throw new Error(`未知参数：${current}`);
  }
  // 缺省镜像位置：WorkBuddy 的技能市场镜像。仍可用 --source 或 WORKDSH_SKILL_MARKETPLACE 覆盖。
  options.source = options.source || process.env.WORKDSH_SKILL_MARKETPLACE || join(homedir(), '.workbuddy', 'skills-marketplace');
  options.source = resolve(options.source.replace(/^~(?=\/|$)/, homedir()));
  if (!existsSync(join(options.source, '.codebuddy-skill', 'marketplace.json'))) {
    throw new Error(`找不到技能镜像：${options.source}\n请用 --source 指定包含 .codebuddy-skill/marketplace.json、skills/ 与 icons/ 的镜像目录，或设置 WORKDSH_SKILL_MARKETPLACE。`);
  }
  if (!options.target) {
    const agentsHome = resolve(process.env.DSH_AGENTS_HOME ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'agents'));
    options.target = join(agentsHome, '.workdsh-catalog');
  }
  options.target = resolve(options.target.replace(/^~(?=\/|$)/, homedir()));
  return options;
}

// 场景策略是可选输入：文件缺失时退回「不过滤」的全量行为，不让构建失败。
async function loadPolicy(path) {
  if (path === 'none' || path === '') return undefined;
  let raw;
  try { raw = await readFile(resolve(path.replace(/^~(?=\/|$)/, homedir())), 'utf8'); }
  catch (cause) {
    if (cause.code === 'ENOENT') { console.warn(`未找到场景策略 ${path}，按不过滤的全量目录构建。`); return undefined; }
    throw cause;
  }
  const policy = JSON.parse(raw);
  if (!policy || typeof policy !== 'object' || !policy.scopes || typeof policy.scopes !== 'object') {
    throw new Error(`场景策略缺少 scopes 定义：${path}`);
  }
  return policy;
}

function resolveScope(policy, requested) {
  if (!policy) return undefined;
  const name = requested || policy.defaultScope || 'all';
  const scope = policy.scopes[name];
  if (!scope) throw new Error(`场景策略中不存在 scope「${name}」，可选：${Object.keys(policy.scopes).join(' / ')}`);
  if (!Array.isArray(scope.scenarios) || !scope.scenarios.length) throw new Error(`scope「${name}」缺少 scenarios 数组。`);
  return { name, label: text(scope.label, 40) ?? name, scenarioSet: new Set(scope.scenarios) };
}

function frontmatterValue(document, key) {
  const match = document.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  try {
    const value = yaml.parse(match[1]);
    const field = value && typeof value === 'object' ? value[key] : undefined;
    return typeof field === 'string' && field.trim() ? field.trim() : undefined;
  } catch { return undefined; }
}

function text(value, limit) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

async function walkTree(directory, depth = 0) {
  if (depth > MAX_DEPTH) return { files: 0, bytes: 0, depth, symlink: false };
  let files = 0; let bytes = 0; let deepest = depth; let symlink = false;
  for (const row of await readdir(directory, { withFileTypes: true })) {
    if (SKIP_FILES.has(row.name) || SKIP_DIRS.has(row.name)) continue;
    const path = join(directory, row.name);
    if (row.isSymbolicLink()) { symlink = true; continue; }
    if (row.isDirectory()) {
      const nested = await walkTree(path, depth + 1);
      files += nested.files; bytes += nested.bytes; deepest = Math.max(deepest, nested.depth);
      symlink = symlink || nested.symlink;
    } else if (row.isFile()) {
      if (SKIP_EXTENSIONS.has(extname(row.name).toLowerCase())) continue;
      files += 1; bytes += (await stat(path)).size;
    }
  }
  return { files, bytes, depth: deepest, symlink };
}

async function copyTree(source, target) {
  await mkdir(target, { recursive: true });
  for (const row of await readdir(source, { withFileTypes: true })) {
    if (SKIP_FILES.has(row.name) || SKIP_DIRS.has(row.name)) continue;
    const from = join(source, row.name); const to = join(target, row.name);
    if (row.isSymbolicLink()) continue;
    if (row.isDirectory()) await copyTree(from, to);
    else if (row.isFile()) {
      if (SKIP_EXTENSIONS.has(extname(row.name).toLowerCase())) continue;
      await copyFile(from, to);
    }
  }
}

const options = parseArguments(process.argv.slice(2));
const marketplaceFile = join(options.source, '.codebuddy-skill', 'marketplace.json');
const skillsRoot = join(options.source, 'skills');
const iconsRoot = join(options.source, 'icons');
const policy = await loadPolicy(options.policy);
const scope = resolveScope(policy, options.scope);
const policySkills = (policy?.skills && typeof policy.skills === 'object') ? policy.skills : {};
const fallbackScenario = policy ? (typeof policy.unclassified === 'string' ? policy.unclassified : 'pending') : undefined;

const marketplace = JSON.parse(await readFile(marketplaceFile, 'utf8'));
if (!Array.isArray(marketplace.skills)) throw new Error('镜像 marketplace.json 缺少 skills 数组。');

function stemOf(file) { return basename(file, extname(file)).toLowerCase(); }

const iconFiles = new Map();
for (const file of await readdir(iconsRoot)) {
  if (!/\.(svg|png|jpe?g|webp)$/i.test(file)) continue;
  iconFiles.set(stemOf(file), file);
}
function matchIcon(source, name) {
  const lowerSource = source.toLowerCase(); const lowerName = name.toLowerCase();
  if (iconFiles.has(lowerSource)) return iconFiles.get(lowerSource);
  if (iconFiles.has(lowerName)) return iconFiles.get(lowerName);
  const alias = Object.entries(ICON_ALIASES).find(([, targetName]) => targetName === name);
  if (alias && iconFiles.has(alias[0])) return iconFiles.get(alias[0]);
  for (const prefix of ICON_PREFIXES) if (iconFiles.has(prefix) && (lowerSource.startsWith(`${prefix}-`) || lowerName.startsWith(`${prefix}-`))) return iconFiles.get(prefix);
  return undefined;
}

const entries = [];
const skipped = [];
const excluded = [];
const iconsUsed = new Set();
for (const row of marketplace.skills) {
  const source = typeof row.source === 'string' ? row.source.trim() : '';
  if (!source || !KEBAB.test(source)) { skipped.push({ source: source || '(空)', reason: '来源目录不是 kebab-case' }); continue; }
  const payload = join(skillsRoot, source);
  let document;
  try { document = (await readFile(join(payload, 'SKILL.md'), 'utf8')).replace(/^\uFEFF/, ''); }
  catch { skipped.push({ source, reason: '缺少 SKILL.md' }); continue; }
  const name = frontmatterValue(document, 'name');
  if (!name || !KEBAB.test(name)) { skipped.push({ source, reason: `frontmatter name 无效：${name ?? '(缺失)'}` }); continue; }
  if (entries.some(entry => entry.name === name)) { skipped.push({ source, reason: `技能名 ${name} 与已有条目重复` }); continue; }
  // 场景归档先于负载遍历：被排除的条目既不入目录也不复制 payload。
  const assignment = policySkills[name] ?? policySkills[source];
  const scenario = typeof assignment?.scenario === 'string' ? assignment.scenario : fallbackScenario;
  // 镜像里少数条目的 name 本身就是英文标识，策略表可用 title 覆盖为中文显示名。
  const title = text(assignment?.title, 80) ?? text(row.name, 80) ?? name;
  if (scope && scenario && !scope.scenarioSet.has(scenario)) {
    excluded.push({ name, title, scenario, reason: `场景「${scenario}」不在 ${scope.name} 范围内` });
    continue;
  }
  await lstat(payload);
  const tree = await walkTree(payload);
  const icon = matchIcon(source, name);
  if (icon) iconsUsed.add(stemOf(icon));
  const limits = [];
  if (tree.files > MAX_FILES) limits.push(`文件 ${tree.files} 个超过 ${MAX_FILES} 上限`);
  if (tree.depth >= MAX_DEPTH) limits.push(`目录嵌套超过 ${MAX_DEPTH} 层`);
  if (tree.bytes > MAX_BYTES) limits.push('负载超过 50 MiB 上限');
  if (tree.symlink) limits.push('包含符号链接');
  const mirroredCategories = Array.isArray(row.tags_zh) ? row.tags_zh.filter(value => typeof value === 'string' && value.trim()).slice(0, 4) : [];
  const policyCategories = Array.isArray(assignment?.categories) ? assignment.categories.filter(value => typeof value === 'string' && value.trim()).slice(0, 4) : [];
  entries.push({
    name,
    title,
    description: text(row.description_zh ?? row.description, 300) ?? text(row.description_en, 300) ?? name,
    descriptionEn: text(row.description_en, 300),
    categories: policyCategories.length ? policyCategories : mirroredCategories,
    ...(scenario ? { scenario } : {}),
    version: text(row.version, 40),
    examples: Array.isArray(row.examples_zh) ? row.examples_zh.filter(value => typeof value === 'string').slice(0, 3) : [],
    icon: icon ? `icons/${icon}` : undefined,
    payload: `payloads/${name}`,
    sourceDirectory: source,
    files: tree.files,
    bytes: tree.bytes,
    installable: limits.length === 0,
    ...(limits.length ? { installLimits: limits } : {}),
  });
}
entries.sort((a, b) => a.name.localeCompare(b.name));

const categories = [...new Set(entries.flatMap(entry => entry.categories))].sort((a, b) => a.localeCompare(b));
const scenarios = [...new Set(entries.flatMap(entry => entry.scenario ? [entry.scenario] : []))].sort((a, b) => a.localeCompare(b));
const catalog = {
  schema: SCHEMA,
  kind: 'workdsh-skill-catalog',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/build-skill-catalog.mjs',
  source: { path: options.source, marketplace: basename(marketplaceFile), entries: marketplace.skills.length, icons: iconFiles.size },
  ...(scope ? { scope: { name: scope.name, label: scope.label, scenarios: [...scope.scenarioSet] } } : {}),
  ...(scenarios.length ? { scenarios } : {}),
  categories,
  entries,
  // 被场景范围排除的技能：数据保留、可查证，重建时加 --scope all 即可全部恢复。
  ...(excluded.length ? { excluded } : {}),
};

const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(`目录条目 ${entries.length} / 市场 ${marketplace.skills.length}，图标文件 ${iconFiles.size}，分类 ${categories.length}`);
console.log(scope ? `场景范围 ${scope.name}（${scope.label}）：纳入 ${entries.length}，排除 ${excluded.length}，覆盖场景 ${scenarios.join('/') || '无'}` : '场景范围：未过滤（全量）');
console.log(`映射图标 ${entries.filter(entry => entry.icon).length} 个，未使用图标 ${[...iconFiles.keys()].filter(stem => !iconsUsed.has(stem)).length} 个`);
console.log(`负载合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`);
for (const entry of entries.filter(row => !row.installable)) console.log(`  受限：${entry.name} — ${entry.installLimits.join('；')}`);
for (const row of excluded) console.log(`  排除：${row.name}（${row.scenario}）— ${row.reason}`);
for (const row of skipped) console.log(`  跳过：${row.source} — ${row.reason}`);
if (policy && scope && scope.name === policy.defaultScope) {
  const pending = [...excluded, ...skipped].length;
  console.log(`提示：以上未纳入项如需回到市场，追加 --scope all 重建；新增镜像技能请登记 ${options.policy}（未登记默认归入「${fallbackScenario}」不纳入）${pending ? '' : '。'}`);
}
if (options.dryRun) { console.log(`dry-run：未写入 ${options.target}`); process.exit(0); }

const target = options.target;
const staging = `${target}.staging-${process.pid}`;
await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, 'payloads'), { recursive: true });
if (iconFiles.size) {
  await mkdir(join(staging, 'icons'), { recursive: true });
  for (const file of iconFiles.values()) await copyFile(join(iconsRoot, file), join(staging, 'icons', file));
}
for (const entry of entries) await copyTree(join(skillsRoot, entry.sourceDirectory), join(staging, entry.payload));
await writeFile(join(staging, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await rename(staging, target);
const digest = createHash('sha256').update(await readFile(join(target, 'catalog.json'))).digest('hex').slice(0, 12);
console.log(`已写入 ${target}（catalog.json sha256:${digest}，schema ${SCHEMA}）`);
