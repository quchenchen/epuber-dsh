import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ActorContext, IdentityService } from 'workdsh-contracts';
import type { KnowledgeSearchScope } from '../services/knowledge-service.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshIdentity: IdentityService; } }

async function actor(ctx: Context, exec: ToolRunContext): Promise<ActorContext> {
  const sessionId = exec.agent ? String(exec.agent.id) : undefined;
  return ctx.workdshIdentity.resolve(sessionId ? { sessionId } : undefined, exec.signal);
}

const excerpt = (value: string, limit = 280): string => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/** What a listing says about how a base can be searched. */
const searchModeOf = (kb: { readonly capabilities?: { readonly vector: boolean; readonly keyword: boolean; readonly wiki: boolean } }): 'inline' | 'wiki' | 'none' => {
  if (!kb.capabilities || kb.capabilities.vector || kb.capabilities.keyword) return 'inline';
  return kb.capabilities.wiki ? 'wiki' : 'none';
};

/**
 * Why a search returned nothing, in terms the caller can act on. A wiki-only
 * base is searchable — it is just matched by term, so the advice differs from
 * the one for an indexed base that genuinely has no match.
 */
const missNote = (scope: readonly KnowledgeSearchScope[], wikiTerm: string | undefined): string => {
  const channels = new Set(scope.flatMap(kb => kb.channels));
  if (!channels.size) {
    return `检索范围内没有可用检索通道：${scope.map(kb => `${kb.name}——${kb.reason ?? '不可检索'}`).join('；')}`;
  }
  if (channels.has('wiki') && !channels.has('inline')) {
    return wikiTerm
      ? `这些知识库只有 wiki 索引（没有向量/关键词索引）。wiki 按术语匹配，已改用「${wikiTerm}」重试仍未命中；请换更具体的术语，或用 knowledge_read 直接读文档原文，不要重复同一问句。`
      : '这些知识库只有 wiki 索引（没有向量/关键词索引）。wiki 按术语匹配，自然语言问句通常失配；请改用实体名/概念名等术语重试，或用 knowledge_read 直接读文档原文。';
  }
  const indexed = scope.filter(kb => kb.channels.includes('inline')).length;
  const wikiOnly = scope.length - indexed;
  return `${indexed} 个知识库走索引检索但未命中；可缩短关键词、换 mode（semantic / keyword），或确认文档已解析完成。${wikiOnly ? `另有 ${wikiOnly} 个库只有 wiki 索引（按术语匹配），可换术语重试。` : ''}`;
};

/** Agent tools that expose the read-only WeKnora knowledge surface with citations. */
export function registerKnowledgeTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_list_kbs',
    description: '列出当前 WeKnora 知识库服务中可访问的知识库、文档数量与可用检索通道（search_mode：inline=向量/关键词索引，wiki=wiki 导览索引，none=不可检索）。需要检索或浏览文档时，先用本工具确定 kb_id，并据此判断该库该怎么检索；结果来自真实知识库服务，不是工作区文件。',
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
                search_mode: { type: 'string', required: true, enum: ['inline', 'wiki', 'none'], description: 'inline=有向量/关键词索引；wiki=只有 wiki 索引（按术语匹配）；none=不可检索。' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.count
        ? value.knowledge_bases.map(kb => `${kb.name}（kb_id=${kb.id}，文档 ${kb.knowledge_count} 篇，检索=${kb.search_mode}）`).join('\n')
        : '知识库服务没有返回任何知识库。' }],
    },
    async execute(_args, exec) {
      const current = await actor(ctx, exec);
      const kbs = await ctx.workdshKnowledge.listKbs(current, exec.signal);
      return {
        count: kbs.length,
        knowledge_bases: kbs.map(kb => ({
          id: kb.id,
          name: kb.name,
          knowledge_count: kb.knowledgeCount,
          description: kb.description,
          search_mode: searchModeOf(kb),
        })),
      };
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
    description: '在知识库中检索。先走向量/关键词索引，命中返回可引用的原文片段（带 knowledge_id、chunk_id 与相关度）；该库没有这类索引而启用了 wiki 时，自动改走 wiki 索引，返回导览页（via=wiki，有 slug/summary，没有 chunk_id）。按 via 决定用法：inline 片段可直接引用，wiki 页只能用于定位、引用须再读原文。wiki 通道是术语匹配，自然语言问句（如「新型电力系统是什么」）会失配，请传术语（如「新型电力系统」）。返回 0 条时 note 会说明是通道不可用还是确实没命中，不要当成接口错误反复重试。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词。索引通道可用自然语言问题；wiki 通道只按术语/实体名匹配。' },
      knowledge_base_ids: { type: 'array', items: { type: 'string' }, description: '要检索的知识库 ID 列表。省略时使用对话中引用的知识库，其次使用设置里的默认知识库。' },
      kb_id: { type: 'string', description: '单个知识库 ID（与 knowledge_base_ids 等价，保留兼容）。' },
      limit: { type: 'integer', description: '返回条数，1–30，默认 10。' },
      mode: { type: 'string', enum: ['hybrid', 'semantic', 'keyword'], description: '索引通道的检索模式，默认 hybrid；wiki 通道不受此参数影响。' },
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
                via: { type: 'string', required: true, enum: ['inline', 'wiki'], description: 'inline=原文片段（可引用）；wiki=派生导览页（只能定位）。' },
                chunk_id: { type: 'string', required: true, description: 'wiki 命中时为空字符串。' },
                knowledge_id: { type: 'string', required: true, description: 'wiki 命中时为空字符串。' },
                knowledge_title: { type: 'string', required: true },
                knowledge_base_id: { type: 'string', required: true },
                score: { type: 'number', required: true, description: 'wiki 命中为 0：页面按匹配位置排序，没有相似度分数。' },
                excerpt: { type: 'string', required: true },
                wiki_slug: { type: 'string' },
                wiki_page_type: { type: 'string' },
                summary: { type: 'string' },
                source_knowledge_ids: { type: 'array', items: { type: 'string' } },
                chunk_ref_count: { type: 'integer' },
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
                channels: { type: 'array', required: true, items: { type: 'string' }, description: '该库可用的检索通道：inline（向量/关键词索引）与/或 wiki。' },
                reason: { type: 'string' },
              },
            },
          },
          wiki_term: { type: 'string', description: '实际用于 wiki 重试的术语（当原问句失配时）。' },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const scope = value.searched_knowledge_bases.length
          ? `\n检索范围：${value.searched_knowledge_bases.map(kb => `${kb.name}（kb_id=${kb.knowledge_base_id}${kb.chunk_count ? `，分块 ${kb.chunk_count}` : ''}，通道 ${kb.channels.length ? kb.channels.join('+') : '无'}）`).join('；')}`
          : '';
        const body = value.count
          ? value.hits.map(hit => hit.via === 'wiki'
            ? `【wiki 导览页：${hit.knowledge_title}｜slug=${hit.wiki_slug ?? ''}｜page_type=${hit.wiki_page_type ?? ''}｜kb_id=${hit.knowledge_base_id}】\n${hit.summary || hit.excerpt}\n（导览页是派生摘要，不是原文；引用原文请用 knowledge_read_wiki 读该 slug，其返回会列出可读的来源文档 knowledge_id）`
            : `【出处：${hit.knowledge_title}｜knowledge_id=${hit.knowledge_id}｜chunk_id=${hit.chunk_id}｜相关度 ${hit.score.toFixed(3)}】\n${hit.excerpt}`).join('\n\n')
          : `知识库中没有找到匹配内容。${value.note ?? ''}`;
        return [{ type: 'text', text: `${body}${scope}` }];
      },
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const kbIds = [...(args.knowledge_base_ids ?? []), ...(args.kb_id ? [args.kb_id] : [])];
      const limit = args.limit;
      const { hits, scope, wikiTerm } = await ctx.workdshKnowledge.searchDetailed(current, {
        query: args.query,
        ...(kbIds.length ? { kbIds } : {}),
        ...(limit === undefined ? {} : { matchCount: limit }),
        ...(args.mode ? { mode: args.mode as 'hybrid' | 'semantic' | 'keyword' } : {}),
      }, exec.signal);
      return {
        count: hits.length,
        hits: hits.map(hit => (hit.via === 'wiki'
          ? {
            via: 'wiki' as const,
            chunk_id: '',
            knowledge_id: '',
            knowledge_title: hit.knowledgeTitle,
            knowledge_base_id: hit.knowledgeBaseId,
            score: hit.score,
            excerpt: excerpt(hit.content),
            wiki_slug: hit.wiki?.slug ?? '',
            wiki_page_type: hit.wiki?.pageType ?? '',
            summary: hit.wiki?.summary ?? '',
            // The search endpoint does not carry source refs; only the page read
            // does. Report the field when it exists instead of an empty array
            // that would read as "this page has no sources".
            ...((hit.wiki?.sourceKnowledgeIds ?? []).length
              ? { source_knowledge_ids: [...(hit.wiki?.sourceKnowledgeIds ?? [])].slice(0, 20) }
              : {}),
            ...(hit.wiki?.chunkRefCount ? { chunk_ref_count: hit.wiki.chunkRefCount } : {}),
          }
          : {
            via: 'inline' as const,
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
          channels: [...kb.channels],
          ...(kb.reason === undefined ? {} : { reason: kb.reason }),
        })),
        ...(wikiTerm === undefined ? {} : { wiki_term: wikiTerm }),
        ...(hits.length || !scope.length ? {} : { note: missNote(scope, wikiTerm) }),
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
    name: 'knowledge_read_wiki',
    description: '读取知识库 wiki 索引中的一页（概念页/实体页/摘要页）全文，返回其正文、来源文档 ID 与引用分块数。wiki 页是 WeKnora 从文档聚合出的派生页，可用于快速理解一个概念并定位到原始文档，但页面文字本身不是原文——需要逐字引用时必须再用 knowledge_read 读 source_knowledge_ids 中的文档。slug 来自 knowledge_search 的 wiki_slug 命中。',
    parameters: {
      kb_id: { type: 'string', required: true, description: '知识库 ID。' },
      slug: { type: 'string', required: true, description: 'wiki 页面 slug，如 concept/xin-xing-dian-li-xi-tong（来自 knowledge_search 的 wiki_slug）。' },
      limit: { type: 'integer', description: '本次最多返回的字符数，1–20000，默认 8000。' },
      offset: { type: 'integer', description: '从 0 开始的字符偏移量，默认 0，用于接续读取长页面。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          knowledge_base_id: { type: 'string', required: true },
          slug: { type: 'string', required: true },
          title: { type: 'string', required: true },
          page_type: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          content: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          next_offset: { type: 'integer' },
          truncated: { type: 'boolean', required: true },
          source_knowledge_ids: { type: 'array', required: true, items: { type: 'string' } },
          chunk_ref_count: { type: 'integer', required: true },
          is_derived: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const sources = value.source_knowledge_ids.length
          ? `\n来源文档（${value.source_knowledge_ids.length} 篇，引用分块 ${value.chunk_ref_count} 个）：${value.source_knowledge_ids.slice(0, 12).map(id => `knowledge_id=${id}`).join('；')}${value.source_knowledge_ids.length > 12 ? ' …' : ''}`
          : '';
        return [{ type: 'text', text: `【wiki 派生页：${value.title}｜slug=${value.slug}｜page_type=${value.page_type}｜kb_id=${value.knowledge_base_id}】\n${value.content}${sources}\n\n注意：本页是派生摘要，逐字引用须用 knowledge_read 读取上述来源文档。` }];
      },
    },
    async execute(args, exec) {
      const current = await actor(ctx, exec);
      const page = await ctx.workdshKnowledge.readWikiPage(current, args.kb_id, args.slug, exec.signal);
      const offset = Math.max(0, Number.isInteger(args.offset) ? args.offset! : 0);
      const limit = Math.min(20_000, Math.max(1, Number.isInteger(args.limit) ? args.limit! : 8_000));
      // `text` is the body with wiki-link markup flattened; `content` keeps the
      // raw links and would read as slug noise to the model.
      const content = page.text.slice(offset, offset + limit);
      const truncated = offset + content.length < page.text.length;
      return {
        knowledge_base_id: page.knowledgeBaseId,
        slug: page.slug,
        title: page.title,
        page_type: page.pageType,
        summary: page.summary,
        content,
        offset,
        ...(truncated ? { next_offset: offset + content.length } : {}),
        truncated,
        source_knowledge_ids: [...page.sourceKnowledgeIds].slice(0, 50),
        chunk_ref_count: page.chunkRefCount,
        // Repeated so the model cannot mistake this page for quoted source text.
        is_derived: true,
      };
    },
  }));
}
