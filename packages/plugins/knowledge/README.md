# workdsh-plugin-knowledge

WorkDSH 的「知识库」一级能力。Host 通过 WeKnora REST `/api/v1` 直连知识库服务，
Client 提供原生面板：知识库列表 → 文档列表（解析状态）→ 文档详情（预览文本 + 分块）→ 混合/语义/关键词检索，
以及新建知识库、上传文档、重新解析、删除文档/知识库。

> 状态：`0.1.0-alpha.1`，**P2 读 + 管理**。与现有「资料库」(`workdsh-plugin-library`) 并存，不修改其行为。
> P2 已包含新建/删除知识库、上传文档（multipart）、重新解析、异步删除与解析状态轮询。

## 能力

| 层 | 内容 |
|---|---|
| Host 服务 | `src/services/weknora-client.ts`（fetch、`X-API-Key`、超时、写操作不自动重试、错误归一化、分页）、`src/services/knowledge-service.ts`（只读查询 + 建/改/删 KB、上传、重新解析、删除、解析状态轮询） |
| 配置存储 | storage domain `workdsh_knowledge`：`connections`（`baseUrl`、默认 KB、凭据引用、超时）、`selections`（按成员 + Session 的知识库绑定）；API Key 值不入库 |
| 凭据 | 通过 `ctx.credentials` 的引用保存（默认引用 `WEKNORA_API_KEY`），每个操作解析一次；只写不读、不进日志 |
| Agent 工具（读） | `knowledge_list_kbs`（含 `search_mode`）、`knowledge_list_documents`、`knowledge_search`（结果带 `via`：inline 有 `knowledge_id`/`chunk_id`，wiki 有 `wiki_slug`/`source_knowledge_ids`）、`knowledge_read`、`knowledge_read_wiki`（读 wiki 页正文与来源文档） |
| Agent 工具（写） | `knowledge_upload`（上传 UTF-8 文本内容并等待解析）、`knowledge_reparse`、`knowledge_delete`（⚠️ 破坏性，必须 `confirm=true`） |
| Client | `main` 槽位 key `workdsh-knowledge` + `sidebar.panellist` 一级入口「知识库」，使用 Harness 原生控件与 `workdsh-ui`，跟随主题 |
| 对话引用 | `@知识库` 提及源 + 输入框左侧入口，绑定当前 Session；`system-prompt/assemble` 每轮注入 `<knowledge-base>` 说明块 |

## 对话中引用知识库

与「资料库」的引用不是一回事：资料库把**固定修订的正文**直接塞进上下文；知识库是**远程检索域**，
远程库可能有上千篇文档，正文不可能整包注入。

因此 `@知识库/能源知识库` 的语义是**绑定检索域**：

1. `onPick` 把 `{kbId, name}` 写入本 Session 的绑定（`workdsh_knowledge.selections`，键含成员与 Session，互不可见）；
2. 每轮 `system-prompt/assemble` 读回绑定，注入 `<knowledge-base name kb_id documents />` 与使用规则：
   先 `knowledge_search`（用注入的 `kb_id`）检索、引用必须标注 `knowledge_title` / `knowledge_id` / `chunk_id`、
   检索为空必须说明没有找到、不得编造；
3. 模型按需检索，正文只在需要时通过工具进入上下文。

设计上的取舍：**不做「自动检索注入」**。`AssembleContext` 只带 `scope` 与 `signal`，不暴露本轮用户消息，
自动检索需要另取会话末条消息并在提示装配路径上引入一次远程调用与延迟；收益（省一次工具调用）
低于风险（每轮多一次 HTTP、失败要降级、注入内容不可审计）。绑定 + 明确指令是更稳的基线；
若后续要自动预检索，应作为独立开关，并按轮记录检索参数与命中以便审计。

失败语义：绑定读取失败（存储/身份/远程）只记 `warn` 并跳过注入，**不阻塞本轮**；绑定写入失败不影响消息发送。

## 使用的 WeKnora REST 契约

| 能力 | 方法 | 路径 |
|---|---|---|
| 知识库列表 / 详情 | GET | `/api/v1/knowledge-bases`、`/api/v1/knowledge-bases/:id` |
| 新建 / 更新 / 删除知识库 | POST / PUT / DELETE | `/api/v1/knowledge-bases`、`/api/v1/knowledge-bases/:id` |
| 文档列表（支持 `parse_status` 过滤） | GET | `/api/v1/knowledge-bases/:id/knowledge?page=&page_size=&parse_status=` |
| 上传文档（multipart 字段 `file` + `fileName`） | POST | `/api/v1/knowledge-bases/:id/knowledge/file` |
| 文档详情（含 `parse_status` / `error_message`） | GET | `/api/v1/knowledge/:id` |
| 原始文件预览 | GET | `/api/v1/knowledge/:id/preview`（用 `Range` 只取前 4KB） |
| 重新解析 / 删除文档 | POST / DELETE | `/api/v1/knowledge/:id/reparse`、`/api/v1/knowledge/:id` |
| 分块列表 | GET | `/api/v1/chunks/:knowledge_id?page=&page_size=` |
| 统一检索（多库 / 文档或标签限定 / 阈值覆盖） | POST | `/api/v1/knowledge-search` |
| 单库检索（旧部署回退路径） | POST | `/api/v1/knowledge-bases/:id/hybrid-search` |
| 租户检索策略（默认阈值、rerank） | GET/PUT | `/api/v1/tenants/kv/retrieval-config` —— **需要 system 读权限，普通 `retrieve` Key 返回 403**，插件不依赖它 |
| wiki 检索（跨库，术语匹配） | POST | `/api/v1/wiki-search`（`query`、`knowledge_base_ids[]`、`limit`；库必须启用 wiki，否则 400） |
| wiki 页面全文 | GET | `/api/v1/knowledgebase/:kb_id/wiki/pages/*slug`（slug 含 `/`，逐段编码） |
| wiki 统计（页数、链接数） | GET | `/api/v1/knowledgebase/:kb_id/wiki/stats` |

响应外层一般为 `{ success, data }`；列表分页字段（`page` / `page_size` / `total`）与 `data` 同级，
`weknora-client.ts` 的 `readPage` 同时兼容数组、`{data:[]}` 与带分页三种形状。
语义检索 = `disable_keywords_match: true`，关键词检索 = `disable_vector_match: true`。
文档删除是**异步任务**（返回 `task_id`），服务提供 `waitForDocumentDeletion` 轮询列表直到消失。

### 检索面与参数口径（对齐 WeKnora 对话 / 智能体）

WeKnora 自己的对话与 `search_knowledge` 工具走 `/api/v1/knowledge-search`，参数是
`knowledge_base_ids[]`、`match_count`、`mode`、可选的 `vector_threshold` / `keyword_threshold`、
`rerank`、`knowledge_ids` / `tag_ids`。插件主路径与之对齐：

- `knowledge_search` 工具：`query`（必填）、`knowledge_base_ids`（多库；省略时用会话绑定库，其次默认库）、
  `kb_id`（单库兼容）、`limit`（1–30，默认 10，对应 `match_count`）、`mode`。
- 阈值**不暴露给模型**：WeKnora 官方工具也不暴露，策略由租户配置决定；插件 Key 通常无权读取该配置（403），
  因此默认不传，由服务端策略生效。
- 部署没有 `/knowledge-search`（404/405）时自动回退到逐库 `hybrid-search` 合并排序。

**零命中不是错误。** 检索跑通但没命中时，WeKnora 返回 `{"data":null,"success":true}`；
`readPage` 把它当空页处理（早期版本曾误判为 `knowledge/malformed`，导致工具报“知识库返回了无法识别的数据”
并诱发模型反复换模式重试）。

### 两条检索通道（inline / wiki）

「没有向量索引」不等于「不可检索」。WeKnora 的知识库可以只开 wiki，此时它有几千个
由文档聚合出的概念页/实体页，由 `/api/v1/wiki-search` 检索。插件按通道自动选择：

| 通道 | 判据 | 接口 | 命中形态 |
|---|---|---|---|
| `inline` | `capabilities.vector` 或 `capabilities.keyword` | `/api/v1/knowledge-search` | 原文分块，带 `knowledge_id` + `chunk_id` + 相关度 |
| `wiki` | 仅 `capabilities.wiki`（或 inline 零命中后兜底） | `/api/v1/wiki-search` | 派生导览页，带 `slug` / `page_type` / 摘要，**无 chunk_id** |

选择顺序：先 inline（可引用原文）；零命中或该库没有 inline 索引时查 wiki；
`wiki_search` 零命中且 query 是问句时，用 `wikiTermOf` 抽出的术语**再试一次**（wiki 是术语匹配，
`新型电力系统是什么` 命中不了而 `新型电力系统` 可以）。

wiki 页是**派生摘要页**，不是原文。工具输出用 `via` 区分两者，渲染层明确写出
「导览页是派生摘要，不是原文；引用原文请用 knowledge_read_wiki 读该 slug，或用 knowledge_read 读
source_knowledge_ids 中的文档」——这是防止把摘要当引文的唯一可靠手段。
wiki 页正文在 Host 侧经 `wikiLinksToText` 把 `[[slug|label]]` 摊平成纯文本后再返回。

零命中时工具附带 `searched_knowledge_bases`（含 `channels`）与 `note`，区分三种情况：

| 情况 | 判据 | 提示 |
|---|---|---|
| 完全不可检索 | `channels` 为空（vector/keyword/wiki 全关） | 说明没有任何检索通道，停止重试 |
| 仅 wiki 通道 | `channels = ['wiki']` | 告知 wiki 按术语匹配，改用实体名/概念名，或用 `knowledge_read` 直接读原文 |
| 索引可检索但没命中 | `channels` 含 `inline` | 建议换更短关键词或换 mode、确认文档解析完成 |

`chunk_count` 在部分部署恒为 0（即使检索正常），因此**只作展示、不作判据**。
面板对仅 wiki 的库标「仅 wiki 检索」，完全不可检索的标「不可检索」。

`tests/live-search.mjs` 对真实部署固定三个事实：无索引库的 inline 检索返回 0 条且不报错、
其 wiki 通道用术语能命中且页面带 `source_refs`/`chunk_refs`、同一问题用问句查 wiki 会失配（这解释了自动术语重试）。

### 图标与入口区分

知识库与资料库是两个入口，图标必须不同：知识库用 `knowledge`（分层索引柱），
资料库用 `library`（书架）。新增图标需重建 `packages/ui`（`IconName` 来自其 `dist`）。

### 新建知识库的配置来源

WeKnora 的知识库必须在创建时绑定向量模型，否则上传的文档会以
`failed to get embedding model` 解析失败。面板的「新建知识库」要求选择一个**模板知识库**，
Host 读取该库的 `embedding_model_id` 与 `chunking_config` 作为创建参数，并固定：

- `indexing_strategy = { vector: true, keyword: true, wiki: false, graph: false }`
- `question_generation_config = { enabled: false }`

这样新文档可以在数秒内解析完成；需要 wiki/图谱/问题生成时在 WeKnora 控制台再打开。

## 配置

面板「设置」中填写：服务地址、默认知识库（可选）、API Key（提交后写入凭据服务，不再回显）。
默认知识库既用于检索兜底，也作为新建知识库的默认模板。

也可以完全用环境变量启动：

```bash
WEKNORA_BASE_URL=http://127.0.0.1:18081 \
WEKNORA_API_KEY=sk-... \
dsh web --profile <profile>
# 可选：WEKNORA_API_KEY_REF=MY_KEY 使用自定义凭据引用名
```

默认值：`baseUrl = http://127.0.0.1:18081`，`apiKeyRef = WEKNORA_API_KEY`，`timeoutMs = 15000`。

### 权限与 Key 分离（生产建议）

写入面（建/删 KB、上传、重新解析、删除文档）需要 API Key 具备 `manage_kbs` / `ingest` 能力。
建议为产品配置两个 Key：默认只读 Key（`retrieve`）用于检索与工具读操作；
管理操作使用单独的 `retrieve + ingest + manage_kbs` Key，并限制可管理的知识库范围。
当前插件所有操作复用同一个 Key，面板上的写操作按钮在 Key 缺少能力时会把 WeKnora 的
`401/403` 归一化为「知识库凭据无效，或当前凭据缺少所需能力」并保持只读可用。

## 开发

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
cd apps/web
corepack pnpm --filter workdsh-plugin-knowledge typecheck
corepack pnpm --filter workdsh-plugin-knowledge build
corepack pnpm --filter workdsh-plugin-knowledge test           # 本地 HTTP stub 单测
corepack pnpm --filter workdsh-plugin-knowledge test:live       # 真实 WeKnora 只读契约
corepack pnpm --filter workdsh-plugin-knowledge test:live:write # 真实 WeKnora 全写入闭环（自动清理）
```

构建产物：`dist/index.js`（Host，ESM）、`dist/client.browser.js`（Client，`window.__ModuleLoader__` 包装）。
Client bundle 由 `apps/web/scripts/build-knowledge.mjs`（esbuild）生成，官方 client 包与 React 外置。

## 安装到隔离 Profile

`cordis.patch.yml` 会 `insert` 一个 `workdsh-knowledge` 插件条目，Host 侧注册
`workdshKnowledge` 服务 + `/api/workdsh-knowledge` 传输端点 + 七个 Agent 工具。
`dsh plugin add` 会把包名自动补进 `dsh.profile.bundles`。

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"

# 1) 构建并打包
cd apps/web && corepack pnpm install
corepack pnpm --filter workdsh-plugin-knowledge typecheck
corepack pnpm --filter workdsh-plugin-knowledge build
cd ../../packages/plugins/knowledge
node ../../../apps/web/node_modules/pnpm/bin/pnpm.cjs pack --pack-destination /tmp/knowledge-pack

# 2) 复制一个隔离 Profile（不要改动正在使用的 preview profile）
cp -a ~/.workdsh/preview/profiles/preview ~/.workdsh/preview/profiles/kbtest
DSH_HOME=$HOME/.workdsh/preview dsh plugin --profile kbtest add \
  /tmp/knowledge-pack/workdsh-plugin-knowledge-0.1.0-alpha.1.tgz

# 3) 启动（API Key 走凭据服务的 env 层，不落库）
cd ~/.workdsh/preview/profiles/kbtest
DSH_HOME=~/.workdsh/preview DSH_AGENTS_HOME=~/.workdsh/preview/agents \
WEKNORA_BASE_URL=http://127.0.0.1:18081 WEKNORA_API_KEY="$(cat /tmp/dsh-key-10000.txt)" \
node node_modules/@deepseek-ai/dsh/lib/bin.js --profile kbtest \
  --host 127.0.0.1 --port 18990 --no-open
```

浏览器访问输出里的 `http://127.0.0.1:18990/?token=...` 即可。验收脚本（仓库内，使用 `@playwright/test` 无头 Chromium）：

```bash
cd apps/web
node scripts/verify-knowledge-isolated.mjs "<login-url-with-token>"   # P1：11 项 GUI 检查 + 截图
node scripts/verify-knowledge-tool.mjs "<login-url-with-token>"       # Agent 调用 knowledge_search 并核对出处
node scripts/verify-knowledge-p2.mjs "<login-url-with-token>"         # P2：新建库/上传/轮询/重解析/删除 + 截图
node scripts/verify-knowledge-write-tools.mjs "<login-url-with-token>" # P2：Agent 调用 knowledge_upload + knowledge_delete
node scripts/verify-knowledge-reference.mjs "<login-url-with-token>"  # P3：@知识库 菜单 / chip / Session 绑定写入与读回
node scripts/verify-knowledge-wiki.mjs "<login-url-with-token>"        # P6.2：图标区隔 / 仅 wiki 标注 / 问句命中 / 展开 wiki 页（10 项）
node scripts/verify-knowledge-wiki-agent.mjs "<login-url-with-token>"  # P6.2：Agent 走 wiki 检索并给出处
```

live 契约检查（不经浏览器，直连 REST）：

```bash
node tests/live-search.mjs   # 不可检索库返回 0 条不报错；可检索库返回带出处命中
```

P2 GUI 脚本会在隔离 Profile 中创建临时知识库「WorkDSH 插件联调」，验证完删除，
并在 finally 中通过 REST 兜底清理，不会改动 能源知识库 / 新型电力系统。

> 已实测的本机变通：若 `dsh plugin --profile kbtest install/add` 在非 TTY 环境因
> `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 或 copied lockfile 的
> `minimumReleaseAge` 供应链策略中止，可把同一 tgz 解包到
> `kbtest/node_modules/workdsh-plugin-knowledge`（`tar xzf <tgz> --strip-components=1`），
> 并在其 `node_modules` 下用符号链接指向 Profile 已有的 `@deepseek-ai/*` 与 `zod`；
> 这不会改变安装字节，只替代 pnpm 的链接步骤。

## 边界与风险

- **写入限制**：上传单文件 ≤ 50MB（WeKnora 默认上限），通过 Host JSON+base64 传输；
  更大文件或批量上传尚未实现，超大请求会占用主进程内存（P3 可改流式/分片）。
- **写操作不自动重试**：创建/更新/上传/删除在超时后不会重放，避免重复建库或重复上传；
  失败后由用户重试。重新解析是幂等的，但同样不自动重试。
- **删除是异步任务**：删除文档后列表可能短暂仍显示该行（状态「删除中」），面板轮询直到消失；
  文档删除后再删知识库需要等待任务完成（面板会轮询 KB 列表）。
- **新建库依赖模板库**：没有可继承配置的现有知识库且未显式提供 `embeddingModelId` 时，
  会返回可操作的错误；纯空租户需要在 WeKnora 控制台先建一个配置好的知识库。
- **解析状态轮询**：文档列表/详情在存在 pending/processing 文档时每 4 秒静默刷新；
  解析失败展示 `error_message`，可用「重新解析」重试。
- **preview 端点**返回原始文件字节，插件只取 HTTP Range 前 4KB；文本类文件直接展示原文，
  DOCX/PDF/PPTX 等显示「已解析分块拼接」的文本预览。
- `knowledge_read` 仅在前 10 页 × 100 块内定位字符偏移；超长文档后续内容需调整 offset。
- 与「资料库」无数据同步；两者入口并存。
