/**
 * Two rules for talking to an MCP endpoint, kept in one place so the runtime and
 * its tests cannot drift.
 *
 * 1. `Authorization` is a scheme plus a value, and the MCP spec uses `Bearer`.
 *    The settings field asks for an access token, so the value on its own has to
 *    be completed here; a value that already carries a scheme must not be
 *    prefixed twice. Sending a bare token makes servers answer "missing bearer
 *    token", which reads like a wrong token and hides the real mistake.
 *
 * 2. A failed start has to say what the endpoint said. The official client wraps
 *    the transport error in "initial connection or tool synchronization failed",
 *    so reporting only the outer message turns every misconfiguration into the
 *    same useless sentence. The cause chain is walked instead, and the shapes we
 *    have actually seen are translated; the raw text stays in the message.
 */

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*\s+\S/;

/** Complete a bare token into an `Authorization` value. */
export function authorizationHeader(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return SCHEME.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

/** Messages of one error and its causes, outermost first, without repeats. */
function causeMessages(cause: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (message && !messages.includes(message)) messages.push(message);
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return messages;
}

/** Endpoint answers we can explain better than the transport does. */
const HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/missing bearer token/i, '授权方式不对：端点要求 Authorization: Bearer，请只填令牌本体。'],
  [/mcp endpoint disabled/i, '该 MCP 端点已被停用。'],
  [/403|forbidden/i, '端点拒绝访问（403）：令牌可能已停用，或该端点已关闭。'],
  [/invalid token|401|unauthorized|requires authorization/i, '令牌被端点拒绝（401）：请确认填的是该 MCP 端点自己的令牌，同一服务的 REST API Key 在这里不通用。'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, '域名解析失败：请检查 MCP URL 的域名与本机网络。'],
  [/ECONNREFUSED|ETIMEDOUT|timed? ?out/i, '连接超时或被拒绝：请检查地址、端口与网络。'],
];

/**
 * One readable sentence for a failed start or health check: the translated
 * cause when it is recognised, otherwise the raw text, always with the
 * endpoint's own words appended so it can be pasted into a bug report.
 */
export function describeConnectorFailure(cause: unknown): string {
  const messages = causeMessages(cause);
  const detail = (messages[messages.length - 1] ?? '').replace(/\s+/g, ' ').slice(0, 160);
  const hint = HINTS.find(([pattern]) => pattern.test(messages.join(' ')))?.[1];
  if (hint && detail) return `${hint}（${detail}）`;
  return hint ?? (detail || 'MCP 服务启动失败。');
}
