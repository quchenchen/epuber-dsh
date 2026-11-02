import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationHeader, describeConnectorFailure } from '../dist/authorization.js';

/**
 * An MCP endpoint authenticates with `Authorization: Bearer <token>`. The
 * settings field collects the token itself, so the scheme is added on the way
 * out — and a value that already carries one must survive untouched, otherwise
 * a pasted "Bearer xxx" would become "Bearer Bearer xxx".
 */

test('a bare token is completed with the Bearer scheme', () => {
  assert.equal(authorizationHeader('mcp_abc123'), 'Bearer mcp_abc123');
  assert.equal(authorizationHeader('  mcp_abc123  '), 'Bearer mcp_abc123');
});

test('a value that already carries a scheme is not prefixed twice', () => {
  assert.equal(authorizationHeader('Bearer mcp_abc123'), 'Bearer mcp_abc123');
  assert.equal(authorizationHeader('bearer mcp_abc123'), 'bearer mcp_abc123');
  assert.equal(authorizationHeader('Basic dXNlcjpwYXNz'), 'Basic dXNlcjpwYXNz');
});

test('an empty token stays empty rather than becoming "Bearer "', () => {
  assert.equal(authorizationHeader(''), '');
  assert.equal(authorizationHeader('   '), '');
});

/**
 * The official client wraps every startup failure in one generic sentence, so a
 * plain `cause.message` told the reader nothing. The translation has to reach
 * the endpoint's own answer, which is the last link of the cause chain.
 */

test('the endpoint answer inside the cause chain names the real problem', () => {
  const failure = new Error('mcp-client(mcp2): initial connection or tool synchronization failed', {
    cause: new Error('Error POSTing to endpoint: {"error":"unauthorized: invalid token"}'),
  });
  const text = describeConnectorFailure(failure);
  assert.match(text, /令牌被端点拒绝/);
  assert.match(text, /invalid token/);
});

test('a missing scheme is reported as a scheme problem, not a wrong token', () => {
  const failure = new Error('outer', { cause: new Error('Error POSTing to endpoint: {"error":"unauthorized: missing bearer token"}') });
  assert.match(describeConnectorFailure(failure), /Bearer/);
});

test('network failures are translated too', () => {
  const refused = new Error('outer', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) });
  assert.match(describeConnectorFailure(refused), /超时或被拒绝/);
  const dns = new Error('outer', { cause: new Error('getaddrinfo ENOTFOUND mcp.example.invalid') });
  assert.match(describeConnectorFailure(dns), /域名解析失败/);
});

test('an unrecognised failure keeps the endpoint words instead of inventing a cause', () => {
  const text = describeConnectorFailure(new Error('outer', { cause: new Error('Tool schema rejected: duplicate tool name') }));
  assert.equal(text, 'Tool schema rejected: duplicate tool name');
  assert.equal(describeConnectorFailure(undefined), 'MCP 服务启动失败。');
});
