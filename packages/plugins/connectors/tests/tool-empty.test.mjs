import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyToolsHint } from '../dist/client/tool-empty.js';

/**
 * The detail dialog printed "停用后工具已从官方目录移除" whenever the tool list was
 * empty, so a connector that was switched on but could not reach its server read
 * as if the user had disabled it. Each state now explains itself.
 */

test('a disabled server is the only one that lost its tools', () => {
  assert.equal(emptyToolsHint('disabled'), '已停用，工具已从官方目录移除。');
});

test('an unreachable server says it is not connected, not that it is off', () => {
  const text = emptyToolsHint('offline');
  assert.match(text, /未连接/);
  assert.doesNotMatch(text, /停用/);
});

test('a server still starting is discovering, not broken', () => {
  assert.match(emptyToolsHint('discovering'), /正在发现工具/);
  assert.match(emptyToolsHint('ready'), /正在发现工具/);
});
