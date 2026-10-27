import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ActorContext, IdentityService } from 'workdsh-contracts';

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
    description: '在知识库中做混合检索（hybrid）、语义检索（semantic）或关键词检索（keyword），返回带出处的原文片段：knowledge_title、knowledge_id、chunk_id 与相关度分数。引用知识库内容前应先调用本工具。',
    parameters: {
      query: { type: 'string', required: true, description: '检索关键词或自然语言问题。' },
      kb_id: { type: 'string', description: '知识库 ID；省略时使用设置中的默认知识库，租户只有一个知识库时自动选择。' },
      match_count: { type: 'integer', description: '返回片段数，1–20，默认 5。' },
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
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.count
        ? value.hits.map(hit => `【出处：${hit.knowledge_title}｜knowledge_id=${hit.knowledge_id}｜chunk_id=${hit.chunk_id}｜相关度 ${hit.score.toFixed(3)}】\n${hit.excerpt}`).join('\n\n')
        : '知识库中没有找到匹配内容。' }],
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const hits = await ctx.workdshKnowledge.search(current, {
        query: args.query,
        ...(args.kb_id ? { kbId: args.kb_id } : {}),
        ...(args.match_count === undefined ? {} : { matchCount: args.match_count }),
        ...(args.mode ? { mode: args.mode as 'hybrid' | 'semantic' | 'keyword' } : {}),
      }, exec.signal);
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
}
