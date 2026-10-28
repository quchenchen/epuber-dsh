import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ActorContext, IdentityService } from 'workdsh-contracts';
import { KnowledgeError } from '../services/weknora-client.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshIdentity: IdentityService; } }

async function actor(ctx: Context, exec: ToolRunContext): Promise<ActorContext> {
  const sessionId = exec.agent ? String(exec.agent.id) : undefined;
  return ctx.workdshIdentity.resolve(sessionId ? { sessionId } : undefined, exec.signal);
}

const excerpt = (value: string, limit = 280): string => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/** Agent tools that expose the read-only WeKnora knowledge surface with citations. */
export function registerKnowledgeTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_list_kbs',
    description: '列出当前 WeKnora 知识库服务中可访问的知识库及其文档数量。需要检索或浏览文档时，先用本工具确定 kb_id；结果来自真实知识库服务，不是工作区文件。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          knowledge_bases: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                knowledge_count: { type: 'integer', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.count
        ? value.knowledge_bases.map(kb => `${kb.name}（kb_id=${kb.id}，文档 ${kb.knowledge_count} 篇）`).join('\n')
        : '知识库服务没有返回任何知识库。' }],
    },
    async execute(_args, exec) {
      const current = await actor(ctx, exec);
      const kbs = await ctx.workdshKnowledge.listKbs(current, exec.signal);
      return { count: kbs.length, knowledge_bases: kbs.map(kb => ({ id: kb.id, name: kb.name, knowledge_count: kb.knowledgeCount, description: kb.description })) };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'knowledge_list_documents',
    description: '分页列出指定知识库中的文档，包含解析状态（parse_status）与失败原因。用于确认知识库中有哪些资料、哪些尚未解析完成。',
    parameters: {
      kb_id: { type: 'string', required: true, description: '知识库 ID（来自 knowledge_list_kbs）。' },
      page: { type: 'integer', description: '从 1 开始的页码，默认 1。' },
      page_size: { type: 'integer', description: '每页条数，1–100，默认 20。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          knowledge_base_id: { type: 'string', required: true },
          page: { type: 'integer', required: true },
          page_size: { type: 'integer', required: true },
          total: { type: 'integer' },
          items: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                knowledge_id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                parse_status: { type: 'string', required: true },
                parse_status_label: { type: 'string', required: true },
                file_type: { type: 'string', required: true },
                error_message: { type: 'string' },
                updated_at: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.items.length
        ? value.items.map(item => `${item.title}（knowledge_id=${item.knowledge_id}，${item.parse_status_label}${item.error_message ? `，失败原因：${item.error_message}` : ''}）`).join('\n')
        : '该知识库当前没有文档。' }],
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const page = await ctx.workdshKnowledge.listDocuments(current, args.kb_id, { page: args.page, pageSize: args.page_size }, exec.signal);
      return {
        knowledge_base_id: args.kb_id,
        page: page.page,
        page_size: page.pageSize,
        ...(page.total === undefined ? {} : { total: page.total }),
        items: page.items.map(item => ({
          knowledge_id: item.id,
          title: item.title,
          parse_status: item.parseStatus,
          parse_status_label: item.parseStatusLabel,
          file_type: item.fileType ?? '',
          ...(item.errorMessage ? { error_message: item.errorMessage } : {}),
          updated_at: item.updatedAt ?? '',
        })),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: '在知识库中做混合检索（hybrid）、语义检索（semantic）或关键词检索（keyword），返回带出处的原文片段：knowledge_title、knowledge_id、chunk_id 与相关度分数。引用知识库内容前应先调用本工具。可一次检索多个知识库；返回 0 条时会说明该库是否可检索（未启用向量/关键词索引、或没有已索引分块），不要把它重复当成接口错误来重试。',
    parameters: {
      query: { type: 'string', required: true, description: '检索关键词或自然语言问题。' },
      knowledge_base_ids: { type: 'array', items: { type: 'string' }, description: '要检索的知识库 ID 列表。省略时使用对话中引用的知识库，其次使用设置里的默认知识库。' },
      kb_id: { type: 'string', description: '单个知识库 ID（与 knowledge_base_ids 等价，保留兼容）。' },
      limit: { type: 'integer', description: '返回片段数，1–30，默认 10。' },
      mode: { type: 'string', enum: ['hybrid', 'semantic', 'keyword'], description: '检索模式，默认 hybrid。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          hits: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                chunk_id: { type: 'string', required: true },
                knowledge_id: { type: 'string', required: true },
                knowledge_title: { type: 'string', required: true },
                knowledge_base_id: { type: 'string', required: true },
                score: { type: 'number', required: true },
                excerpt: { type: 'string', required: true },
              },
            },
          },
          searched_knowledge_bases: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                knowledge_base_id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                chunk_count: { type: 'integer', required: true },
                searchable: { type: 'boolean', required: true },
                reason: { type: 'string' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const scope = value.searched_knowledge_bases.length
          ? `\n检索范围：${value.searched_knowledge_bases.map(kb => `${kb.name}（kb_id=${kb.knowledge_base_id}${kb.chunk_count ? `，分块 ${kb.chunk_count}` : ''}${kb.searchable ? '' : '，不可检索'}）`).join('；')}`
          : '';
        const body = value.count
          ? value.hits.map(hit => `【出处：${hit.knowledge_title}｜knowledge_id=${hit.knowledge_id}｜chunk_id=${hit.chunk_id}｜相关度 ${hit.score.toFixed(3)}】\n${hit.excerpt}`).join('\n\n')
          : `知识库中没有找到匹配内容。${value.note ?? ''}`;
        return [{ type: 'text', text: `${body}${scope}` }];
      },
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const kbIds = [...(args.knowledge_base_ids ?? []), ...(args.kb_id ? [args.kb_id] : [])];
      const limit = args.limit;
      const { hits, scope } = await ctx.workdshKnowledge.searchDetailed(current, {
        query: args.query,
        ...(kbIds.length ? { kbIds } : {}),
        ...(limit === undefined ? {} : { matchCount: limit }),
        ...(args.mode ? { mode: args.mode as 'hybrid' | 'semantic' | 'keyword' } : {}),
      }, exec.signal);
      const searchable = scope.filter(kb => kb.searchable);
      const unsearchable = scope.filter(kb => !kb.searchable);
      const note = !hits.length && scope.length
        ? unsearchable.length === scope.length
          ? `检索范围内没有任何可检索的知识库：${unsearchable.map(kb => `${kb.name}——${kb.reason ?? '不可检索'}`).join('；')}`
          : `${searchable.length} 个知识库可检索但本次未命中；可尝试更短的关键词、换 mode（semantic / keyword），或确认文档已解析完成。`
        : undefined;
      return {
        count: hits.length,
        hits: hits.map(hit => ({
          chunk_id: hit.chunkId,
          knowledge_id: hit.knowledgeId,
          knowledge_title: hit.knowledgeTitle,
          knowledge_base_id: hit.knowledgeBaseId,
          score: hit.score,
          excerpt: excerpt(hit.content),
        })),
        searched_knowledge_bases: scope.map(kb => ({
          knowledge_base_id: kb.id,
          name: kb.name,
          chunk_count: kb.chunkCount,
          searchable: kb.searchable,
          ...(kb.reason === undefined ? {} : { reason: kb.reason }),
        })),
        ...(note === undefined ? {} : { note }),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'knowledge_read',
    description: '按字符偏移读取一篇知识库文档的解析正文（由分块拼接），返回出处信息与下一页偏移。knowledge_id 来自 knowledge_search 或 knowledge_list_documents。',
    parameters: {
      knowledge_id: { type: 'string', required: true, description: '文档 ID。' },
      offset: { type: 'integer', description: '从 0 开始的字符偏移量，默认 0。' },
      limit: { type: 'integer', description: '本次最多返回的字符数，1–20000，默认 8000。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          knowledge_id: { type: 'string', required: true },
          knowledge_base_id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          next_offset: { type: 'integer' },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `【出处：${value.title}｜knowledge_id=${value.knowledge_id}｜knowledge_base_id=${value.knowledge_base_id}】\n${value.content}` }],
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const result = await ctx.workdshKnowledge.readDocument(current, args.knowledge_id, {
        ...(args.offset === undefined ? {} : { offset: args.offset }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }, exec.signal);
      return {
        knowledge_id: result.knowledgeId,
        knowledge_base_id: result.knowledgeBaseId ?? '',
        title: result.title,
        content: result.content,
        offset: result.offset,
        ...(result.nextOffset === undefined ? {} : { next_offset: result.nextOffset }),
        truncated: result.truncated,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'knowledge_upload',
    description: '把 UTF-8 文本内容作为新文档上传到知识库（写入操作：会在知识库中创建文档并触发异步解析）。文件名后缀决定解析器（.md/.txt/.html/.csv/.json 等）。默认等待解析结束后返回 parse_status；不会覆盖同名文档。',
    parameters: {
      kb_id: { type: 'string', required: true, description: '目标知识库 ID（来自 knowledge_list_kbs）。' },
      file_name: { type: 'string', required: true, description: '文档文件名，例如 notes.md；无后缀时默认 .md。' },
      content: { type: 'string', required: true, description: '文档的 UTF-8 文本内容，最大 512K 字符。' },
      wait: { type: 'boolean', description: '是否等待解析完成，默认 true。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          knowledge_id: { type: 'string', required: true },
          knowledge_base_id: { type: 'string', required: true },
          file_name: { type: 'string', required: true },
          parse_status: { type: 'string', required: true },
          parse_status_label: { type: 'string', required: true },
          error_message: { type: 'string' },
          timed_out: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已上传 ${value.file_name}（knowledge_id=${value.knowledge_id}），解析状态：${value.parse_status_label}${value.error_message ? `，失败原因：${value.error_message}` : ''}${value.timed_out ? '（等待解析超时，可稍后用 knowledge_list_documents 查看）' : ''}` }],
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const content = args.content;
      if (!content.trim()) throw new KnowledgeError('knowledge/invalid-request', '上传内容不能为空。');
      if (content.length > 512 * 1024) throw new KnowledgeError('knowledge/invalid-request', '上传内容超过 512K 字符上限。');
      const rawName = args.file_name.trim() || 'document.md';
      const fileName = rawName.includes('.') ? rawName : `${rawName}.md`;
      const uploaded = await ctx.workdshKnowledge.uploadDocument(current, args.kb_id, {
        fileName,
        bytes: new TextEncoder().encode(content),
        mediaType: fileName.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain',
      }, exec.signal);
      let document = uploaded;
      let timedOut = false;
      if (args.wait !== false) {
        const waited = await ctx.workdshKnowledge.waitForDocument(current, uploaded.id, { timeoutMs: 120_000, intervalMs: 3_000 }, exec.signal);
        document = waited.document;
        timedOut = waited.timedOut;
      }
      return {
        knowledge_id: document.id,
        knowledge_base_id: document.knowledgeBaseId,
        file_name: fileName,
        parse_status: document.parseStatus,
        parse_status_label: document.parseStatusLabel,
        ...(document.errorMessage ? { error_message: document.errorMessage } : {}),
        timed_out: timedOut,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'knowledge_reparse',
    description: '重新解析一篇文档并重建其分块与索引（写入操作：会覆盖现有分块/索引并重新消耗解析资源）。默认等待解析结束后返回 parse_status。',
    parameters: {
      knowledge_id: { type: 'string', required: true, description: '文档 ID。' },
      wait: { type: 'boolean', description: '是否等待解析完成，默认 true。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          knowledge_id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          parse_status: { type: 'string', required: true },
          parse_status_label: { type: 'string', required: true },
          error_message: { type: 'string' },
          timed_out: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已提交重新解析：${value.title}（${value.knowledge_id}），当前状态 ${value.parse_status_label}${value.error_message ? `，失败原因：${value.error_message}` : ''}` }],
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      let document = await ctx.workdshKnowledge.reparseDocument(current, args.knowledge_id, exec.signal);
      let timedOut = false;
      if (args.wait !== false) {
        const waited = await ctx.workdshKnowledge.waitForDocument(current, args.knowledge_id, { timeoutMs: 120_000, intervalMs: 3_000 }, exec.signal);
        document = waited.document;
        timedOut = waited.timedOut;
      }
      return {
        knowledge_id: document.id,
        title: document.title,
        parse_status: document.parseStatus,
        parse_status_label: document.parseStatusLabel,
        ...(document.errorMessage ? { error_message: document.errorMessage } : {}),
        timed_out: timedOut,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'knowledge_delete',
    description: '⚠️ 破坏性写入：永久删除知识库中的一篇文档及其分块与索引，删除异步执行且不可恢复。必须显式传 confirm=true；调用前应先向用户确认目标文档名称与知识库。当前不支持删除整个知识库。',
    parameters: {
      knowledge_id: { type: 'string', required: true, description: '要删除的文档 ID。' },
      confirm: { type: 'boolean', required: true, description: '破坏性操作确认位；必须为 true，否则拒绝执行。' },
      wait: { type: 'boolean', description: '是否等待删除任务生效，默认 true。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          knowledge_id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          queued: { type: 'boolean', required: true },
          task_id: { type: 'string' },
          deleted: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.deleted ? `已删除文档：${value.title}（${value.knowledge_id}）。` : `删除任务已提交：${value.title}（${value.knowledge_id}），尚未从列表消失。` }],
    },
    async execute(args, exec) {
      if (args.confirm !== true) throw new KnowledgeError('knowledge/invalid-request', '删除是破坏性操作，必须显式传入 confirm=true，并先向用户确认。');
      const current = await actor(ctx, exec);
      const document = await ctx.workdshKnowledge.getDocument(current, args.knowledge_id, exec.signal);
      const result = await ctx.workdshKnowledge.deleteDocument(current, args.knowledge_id, exec.signal);
      let deleted = false;
      if (args.wait !== false) deleted = await ctx.workdshKnowledge.waitForDocumentDeletion(current, document.knowledgeBaseId, args.knowledge_id, { timeoutMs: 60_000, intervalMs: 2_000 }, exec.signal);
      return {
        knowledge_id: args.knowledge_id,
        title: document.title,
        queued: result.queued,
        ...(result.taskId ? { task_id: result.taskId } : {}),
        deleted,
      };
    },
  }));
}
