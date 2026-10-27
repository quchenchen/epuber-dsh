import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { KnowledgeError, WeKnoraClient, readPage } from '../dist/services/weknora-client.js';

/** Minimal HTTP stub: records requests and lets each test answer its own paths. */
async function startStub(handler) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body };
      requests.push(entry);
      handler(entry, response);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

test('getPage unwraps the bare { success, data } envelope', async () => {
  const stub = await startStub((_request, response) => json(response, 200, {
    success: true,
    data: [
      { id: 'kb-1', name: '能源知识库', knowledge_count: 1021 },
      { id: 'kb-2', name: '新型电力系统', knowledge_count: 7 },
    ],
  }));
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    const page = await client.getPage('/api/v1/knowledge-bases', { page: 1, page_size: 20 });
    assert.equal(page.items.length, 2);
    assert.equal(page.items[1].name, '新型电力系统');
    assert.equal(stub.requests[0].headers['x-api-key'], 'test-key');
    assert.equal(stub.requests[0].url, '/api/v1/knowledge-bases?page=1&page_size=20');
  } finally { await stub.close(); }
});

test('readPage handles pagination fields beside data', () => {
  const page = readPage({ success: true, data: [{ id: 'a' }, { id: 'b' }], page: 3, page_size: 2, total: 7 });
  assert.equal(page.page, 3);
  assert.equal(page.pageSize, 2);
  assert.equal(page.total, 7);
  assert.equal(page.items.length, 2);
});

test('readPage handles a bare array and rejects unreadable payloads', () => {
  assert.deepEqual(readPage([{ id: 'a' }]).items, [{ id: 'a' }]);
  assert.throws(() => readPage({ nope: true }), (error) => error instanceof KnowledgeError && error.code === 'knowledge/malformed');
});

test('getRaw keeps a bounded prefix and reads the real length from Content-Range', async () => {
  const stub = await startStub((_request, response) => {
    response.writeHead(206, {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="plan.pdf"',
      'content-range': 'bytes 0-15/4096',
    });
    response.end(Buffer.from('%PDF-1.7 preview'));
  });
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    const raw = await client.getRaw('/api/v1/knowledge/doc/preview', { range: 'bytes=0-15', maxBytes: 16 });
    assert.equal(raw.status, 206);
    assert.equal(raw.contentType, 'application/pdf');
    assert.equal(raw.contentLength, 4096);
    assert.equal(raw.bytes.byteLength, 16);
  } finally { await stub.close(); }
});

test('postJson sends the search body and unwraps hits', async () => {
  const stub = await startStub((_request, response) => json(response, 200, {
    success: true,
    data: [{ id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: '新型电力系统建设“十五五”规划.pdf', score: 0.979, content: '规划目标' }],
  }));
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    const page = await client.postPage('/api/v1/knowledge-bases/kb-1/hybrid-search', { query_text: '规划目标', match_count: 5, disable_keywords_match: true });
    assert.equal(page.items[0].knowledge_title, '新型电力系统建设“十五五”规划.pdf');
    assert.deepEqual(JSON.parse(stub.requests[0].body), { query_text: '规划目标', match_count: 5, disable_keywords_match: true });
  } finally { await stub.close(); }
});

test('HTTP failures normalize to stable codes', async () => {
  const stub = await startStub((request, response) => {
    if (request.url === '/api/v1/knowledge-bases') json(response, 401, { success: false, message: 'invalid api key' });
    else json(response, 404, { success: false, message: 'not found' });
  });
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    await assert.rejects(client.getPage('/api/v1/knowledge-bases'), (error) => error instanceof KnowledgeError && error.code === 'knowledge/unauthorized' && error.status === 401);
    await assert.rejects(client.getJson('/api/v1/knowledge/missing'), (error) => error instanceof KnowledgeError && error.code === 'knowledge/not-found');
  } finally { await stub.close(); }
});

test('5xx responses retry once and then surface knowledge/upstream', async () => {
  let calls = 0;
  const stub = await startStub((_request, response) => { calls += 1; json(response, 500, { success: false, message: 'boom' }); });
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key', retries: 1 });
    await assert.rejects(client.getJson('/api/v1/knowledge-bases'), (error) => error instanceof KnowledgeError && error.code === 'knowledge/upstream');
    assert.equal(calls, 2);
  } finally { await stub.close(); }
});

test('a slow endpoint reports knowledge/timeout', async () => {
  const stub = await startStub((_request, response) => { setTimeout(() => json(response, 200, { success: true, data: [] }), 400); });
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key', timeoutMs: 120, retries: 0 });
    await assert.rejects(client.getJson('/api/v1/knowledge-bases'), (error) => error instanceof KnowledgeError && error.code === 'knowledge/timeout');
  } finally { await stub.close(); }
});

test('an empty API key is rejected before any request', () => {
  assert.throws(() => new WeKnoraClient({ baseUrl: 'http://127.0.0.1:1', apiKey: '   ' }), (error) => error instanceof KnowledgeError && error.code === 'knowledge/credential-missing');
});

test('unsafe base URLs are rejected', () => {
  assert.throws(() => new WeKnoraClient({ baseUrl: 'file:///etc/passwd', apiKey: 'k' }), (error) => error instanceof KnowledgeError && error.code === 'knowledge/invalid-config');
});

test('putJson and deleteJson send write requests', async () => {
  const stub = await startStub((request, response) => {
    if (request.method === 'PUT') json(response, 200, { success: true, data: { id: 'kb-1', name: 'renamed' } });
    else json(response, 200, { success: true, message: 'deleted', data: {} });
  });
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    const updated = await client.putJson('/api/v1/knowledge-bases/kb-1', { name: 'renamed', description: 'd' }, undefined);
    await client.deleteJson('/api/v1/knowledge-bases/kb-1', undefined);
    assert.equal(stub.requests[0].method, 'PUT');
    assert.deepEqual(JSON.parse(stub.requests[0].body), { name: 'renamed', description: 'd' });
    assert.equal(stub.requests[1].method, 'DELETE');
    assert.equal(updated.success, true);
  } finally { await stub.close(); }
});

test('postMultipart sends a multipart body with the file part', async () => {
  const stub = await startStub((_request, response) => json(response, 200, { success: true, data: { id: 'doc-1', title: 'note.md', parse_status: 'pending' } }));
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    const form = new FormData();
    form.append('file', new Blob([new TextEncoder().encode('# hello')], { type: 'text/markdown' }), 'note.md');
    form.append('fileName', 'note.md');
    const created = await client.postMultipart('/api/v1/knowledge-bases/kb-1/knowledge/file', form);
    assert.equal(created.id, 'doc-1');
    const request = stub.requests[0];
    assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(request.body, /filename="note.md"/);
    assert.match(request.body, /# hello/);
  } finally { await stub.close(); }
});

test('write requests are not retried on 5xx', async () => {
  let calls = 0;
  const stub = await startStub((_request, response) => { calls += 1; json(response, 500, { success: false, message: 'boom' }); });
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key', retries: 2 });
    await assert.rejects(client.putJson('/api/v1/knowledge-bases/kb-1', { name: 'x' }), (error) => error instanceof KnowledgeError && error.code === 'knowledge/upstream');
    assert.equal(calls, 1);
  } finally { await stub.close(); }
});

test('deleteJson surfaces a 404 as knowledge/not-found', async () => {
  const stub = await startStub((_request, response) => json(response, 404, { success: false, message: 'no such knowledge' }));
  try {
    const client = new WeKnoraClient({ baseUrl: stub.baseUrl, apiKey: 'test-key' });
    await assert.rejects(client.deleteJson('/api/v1/knowledge/missing'), (error) => error instanceof KnowledgeError && error.code === 'knowledge/not-found');
  } finally { await stub.close(); }
});
