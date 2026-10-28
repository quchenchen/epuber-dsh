import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSessionLog } from './session-log.mjs';

/**
 * Verify one Session log against the wiki-channel contract.
 *
 * The UI-driven script (`verify-knowledge-wiki-agent.mjs`) has to guess when a
 * turn lands: the log is written in one batch after the turn ends, and this
 * preview build can post a new session's turn into an existing session. That
 * makes wall-clock polling fragile. This script takes the log itself as input,
 * so the same assertions run deterministically on a real turn.
 *
 * Usage:
 *   node scripts/verify-knowledge-wiki-session.mjs [session-id-or-path]
 *
 * With no argument it picks the newest log that contains a `knowledge_search`
 * call, so it can be pointed at whatever the operator just did by hand.
 */
const arg = process.argv[2];
const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), '.workdsh/preview'), 'sessions');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });

// Session logs are multi-frame zstd; see session-log.mjs for why this matters.
const decompress = async file => (await readSessionLog(file)).text;

const locate = async () => {
  if (arg) {
    if (arg.endsWith('.zstd')) return arg;
    for (const workspace of await readdirSafe(sessionsRoot)) {
      const candidate = join(sessionsRoot, workspace, arg, 'session.v4.jsonl.zstd');
      if (await readFile(candidate).then(() => true).catch(() => false)) return candidate;
    }
    throw new Error(`session not found: ${arg}`);
  }
  const found = [];
  for (const workspace of await readdirSafe(sessionsRoot)) {
    for (const session of await readdirSafe(join(sessionsRoot, workspace))) {
      const file = join(sessionsRoot, workspace, session, 'session.v4.jsonl.zstd');
      const text = await decompress(file).catch(() => undefined);
      if (text?.includes('knowledge_search') && text.includes('"type":"turn/end"')) found.push({ file, text });
    }
  }
  if (!found.length) throw new Error('no session with a knowledge_search turn found');
  return found[found.length - 1].file;
};

async function readdirSafe(dir) {
  return readdir(dir).catch(() => []);
}

const file = await locate();
const raw = await decompress(file);
const events = raw.trim().split('\n').map(line => JSON.parse(line));
const report = { checks: [], file };
const check = (name, condition, detail = '') => {
  if (!condition) throw new Error(`FAILED: ${name}${detail ? ` (${detail})` : ''}`);
  report.checks.push(name);
  console.log(`PASS ${name}`);
};

const toolCalls = events.filter(event => event.type === 'tool/call').map(event => ({
  name: event.data?.name,
  args: (() => { try { return JSON.parse(event.data?.arguments ?? '{}'); } catch { return {}; } })(),
}));
const toolResults = events.filter(event => event.type === 'tool/result')
  .map(event => (event.data?.message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'))
  .join('\n');
const assistant = events.filter(event => event.type === 'assistant/message')
  .flatMap(event => event.data?.message?.content ?? [])
  .filter(part => part.type === 'text').map(part => part.text).join('\n');
const searchCall = toolCalls.find(call => call.name === 'knowledge_search');
const kbId = searchCall?.args?.kb_id;

check('轮次已正常结束', events.some(event => event.type === 'turn/end' && event.data?.reason?.kind === 'completed'));
check('对话注入了知识库绑定', /以下知识库已被用户显式加入/.test(raw), 'binding block missing');
check('注入块带真实 kb_id', Boolean(kbId) && raw.includes(kbId), `kb_id=${kbId ?? '<none>'}`);
check('模型调用了 knowledge_search', Boolean(searchCall));
check('检索未报接口错误', !/无法识别的数据|knowledge\/malformed/.test(raw));
check('命中标识为 wiki 导览页', /wiki 导览页/.test(toolResults), 'no wiki hit rendered');
check('wiki 命中明确不是原文', /导览页是派生摘要，不是原文/.test(toolResults));
check('未残留 wiki 链接标记', !/\[\[[a-z]+\//.test(toolResults), 'found [[slug|label]] in tool output');
check('回答给出可核对出处', Boolean(kbId) && new RegExp(`${kbId}|(concept|entity|summary)/`).test(assistant), assistant.slice(0, 140));
const followUp = toolCalls.filter(call => call.name === 'knowledge_read_wiki' || call.name === 'knowledge_read');
report.followUp = followUp.map(call => ({ name: call.name, args: call.args }));
report.assistant = assistant;

console.log(`\nfile: ${file}`);
console.log(`kb_id: ${kbId ?? '<none>'}`);
console.log(`tools: ${toolCalls.map(call => call.name).join(' → ')}`);
console.log(`\n--- assistant ---\n${assistant.slice(0, 700)}`);
await writeFile(`${shots}knowledge-wiki-session.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nSESSION WIKI OK · ${report.checks.length} checks · ${shots}knowledge-wiki-session.json`);
