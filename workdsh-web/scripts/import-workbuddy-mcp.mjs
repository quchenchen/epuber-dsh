#!/usr/bin/env node
// Import enabled MCP server definitions from the local WorkBuddy config
// into the AI Convergence Media Center connector storage (per-record JSON files owned by the
// connectors plugin's `workdsh_connectors` domain).
//
// Source: ~/.workbuddy/mcp.json (override with WORKBUDDY_MCP), the WorkBuddy
// user-level MCP registry. Only entries that can actually run standalone are
// imported:
//   - `url` entries        -> streamable-http connectors
//   - `command` entries    -> stdio connectors
// Skipped honestly (with a reason per entry):
//   - disabled entries
//   - `sse` transport (AI Convergence Media Center supports stdio / streamable-http only)
//   - headers/env containing ${VAR} credential placeholders (credentials must
//     go through the AI Convergence Media Center credential flow, never a definition file)
//
// Target: $WORKDSH_PREVIEW_HOME/storages/workdsh_connectors/definitions/<id>.json
// (default preview home: <repo>/.test-runtime/preview). The running preview
// Host loads definitions at startup: restart the preview after importing.
//
// Usage:
//   node scripts/import-workbuddy-mcp.mjs [--dry-run]
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const dryRun = process.argv.includes('--dry-run');
const sourceFile = resolve((process.env.WORKBUDDY_MCP ?? join(homedir(), '.workbuddy/mcp.json')).replace(/^~(?=\/|$)/, homedir()));
const previewHome = resolve((process.env.WORKDSH_PREVIEW_HOME ?? join(root, '.test-runtime/preview')).replace(/^~(?=\/|$)/, homedir()));
const definitionsDir = join(previewHome, 'storages/workdsh_connectors/definitions');

// Operator-maintained display metadata; unknown servers fall back to the id.
// Third-party service names are never auto-translated.
const KNOWN = {
  'ardot-design': {
    title: 'WorkBuddy 设计画布（Ardot）',
    description: 'WorkBuddy 内置设计画布 MCP：设计文件创建与批量编辑、组件库、样式指南、设计稿导出。需本机运行 WorkBuddy 应用（127.0.0.1:50501 由其托管），未运行时显示离线。',
  },
};

const idPart = (value) => value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

let raw;
try { raw = JSON.parse(await readFile(sourceFile, 'utf8')); }
catch (error) { throw new Error(`无法读取 WorkBuddy MCP 配置 ${sourceFile}：${error.message}`); }
const servers = raw?.mcpServers;
if (!servers || typeof servers !== 'object') throw new Error('WorkBuddy MCP 配置缺少 mcpServers 对象。');

const existing = new Map();
try {
  for (const file of await readdir(definitionsDir)) {
    if (!file.endsWith('.json')) continue;
    try { existing.set(JSON.parse(await readFile(join(definitionsDir, file), 'utf8')).record?.serverName, file); }
    catch { /* damaged record: leave it to the Host's real diagnostics */ }
  }
} catch { /* definitions dir absent: first import */ }

const imported = [];
const skipped = [];
for (const [serverName, config] of Object.entries(servers)) {
  const known = KNOWN[serverName] ?? {};
  const title = known.title ?? serverName;
  const base = { serverName, source: sourceFile };
  if (config?.disabled === true) { skipped.push({ ...base, reason: 'WorkBuddy 中已停用' }); continue; }
  if (typeof config?.url === 'string' && config.url.trim() && !/^\$\{/.test(config.url)) {
    if ((config.type ?? '').toLowerCase() === 'sse') { skipped.push({ ...base, reason: 'sse 传输暂不支持' }); continue; }
    if (config.headers && Object.values(config.headers).some(value => /\$\{[^}]+\}/.test(String(value)))) { skipped.push({ ...base, reason: 'headers 含凭据占位符，需走「AI融媒中心」凭据流程' }); continue; }
    imported.push({ serverName, title, transport: 'streamable-http', url: config.url.trim(), description: known.description ?? `从 WorkBuddy 导入的 MCP 服务（${serverName}，streamable-http）。` });
  } else if (typeof config?.command === 'string' && config.command.trim()) {
    if (config.env && Object.values(config.env).some(value => /\$\{[^}]+\}/.test(String(value)))) { skipped.push({ ...base, reason: 'env 含凭据占位符，需走「AI融媒中心」凭据流程' }); continue; }
    imported.push({ serverName, title, transport: 'stdio', command: config.command.trim(), args: [...(Array.isArray(config.args) ? config.args : [])], description: known.description ?? `从 WorkBuddy 导入的 MCP 服务（${serverName}，stdio）。` });
  } else skipped.push({ ...base, reason: '无 url/command，无法独立运行' });
}

console.log(`源配置 ${sourceFile}`);
console.log(`目标目录 ${definitionsDir}${dryRun ? '（dry-run：未写入）' : ''}`);
for (const entry of imported) {
  if (existing.has(entry.serverName)) { console.log(`  已存在，跳过：${entry.serverName}（${existing.get(entry.serverName)}）`); continue; }
  const id = idPart(entry.serverName) || 'mcp';
  const now = new Date().toISOString();
  const record = { version: 1, record: { id, title: entry.title, description: entry.description, serverName: entry.serverName, transport: entry.transport,
    ...(entry.transport === 'stdio' ? { command: entry.command, args: entry.args } : { url: entry.url }),
    enabled: true, createdAt: now, updatedAt: now } };
  // Mirror the connectors plugin's own validation bounds before writing.
  if (record.record.serverName.length > 32) { console.log(`  serverName 超长，跳过：${entry.serverName}`); continue; }
  if (!dryRun) await writeFile(join(definitionsDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`  导入：${entry.serverName} -> ${id}.json（${entry.transport}，启用）`);
}
for (const row of skipped) console.log(`  不导入：${row.serverName} — ${row.reason}`);
console.log('提示：定义在 Host 启动时加载并真实连接；完成后请重启预览（corepack pnpm preview）。');
