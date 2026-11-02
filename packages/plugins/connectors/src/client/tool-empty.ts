import type { ConnectorState } from '../shared.js';

/**
 * What an empty tool list means depends on the state, and the dialog used to
 * say "停用后工具已从官方目录移除" for every case — including a connector that is
 * switched on but cannot connect. That sentence is only true when the server is
 * actually disabled; an unreachable one has simply not discovered anything yet.
 */
export function emptyToolsHint(state: ConnectorState): string {
  if (state === 'disabled') return '已停用，工具已从官方目录移除。';
  if (state === 'offline') return '未连接，暂无可用工具。';
  return '正在发现工具…';
}
