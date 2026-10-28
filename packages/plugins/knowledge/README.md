# workdsh-plugin-knowledge

WorkDSH 的「知识库」一级能力。Host 通过 WeKnora REST `/api/v1` 直连知识库服务，
Client 提供原生面板：知识库列表 → 文档列表（解析状态）→ 文档详情（预览文本 + 分块）→ 混合/语义/关键词检索。

> 状态：`0.1.0-alpha.1`，**只读**。与现有「资料库」(`workdsh-plugin-library`) 并存，不修改其行为。
> 插件**不创建、不修改、不删除**任何知识库或文档（理由见「为什么不提供写入」），因此只用到 Key 的 `retrieve` 能力。
> **当前部署的 Key 保持原样、未做收窄**（WeKnora 侧不为此调整），仍带 `ingest` / `manage_kbs`；
> 这段多余能力只影响 Key 泄露时的爆炸半径，不影响插件功能。

## 能力

| 层 | 内容 |
|---|---|
| Host 服务 | `src/services/weknora-client.ts`（fetch、`X-API-Key`、超时、错误归一化、分页；**没有 PUT/DELETE 传输面**）、`src/services/knowledge-service.ts`（只读查询 + 解析状态轮询） |
| 配置存储 | storage domain `workdsh_knowledge`：`connections`（**组织级**：`baseUrl`、默认 KB、凭据引用、超时，键 = `org_<organizationId>`）、`selections`（按成员 + Session 的知识库绑定）；API Key 值不入库 |
| 凭据 | 通过 `ctx.credentials` 的引用保存（默认引用 `WEKNORA_API_KEY`），每个操作解析一次；只写不读、不进日志 |
| Agent 工具 | `knowledge_list_kbs`（含 `search_mode`）、`knowledge_list_documents`、`knowledge_search`（结果带 `via`：inline 有 `knowledge_id`/`chunk_id`，wiki 有 `wiki_slug`/`source_knowledge_ids`）、`knowledge_read`、`knowledge_read_wiki`（读 wiki 页正文与来源文档） |
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
| 文档列表（支持 `parse_status` 过滤） | GET | `/api/v1/knowledge-bases/:id/knowledge?page=&page_size=&parse_status=` |
| 文档详情（含 `parse_status` / `error_message`） | GET | `/api/v1/knowledge/:id` |
| 原始文件预览 | GET | `/api/v1/knowledge/:id/preview`（用 `Range` 只取前 4KB） |
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

### 为什么不提供写入

插件曾经有过完整写入面（建/改/删知识库、上传、重新解析、删除文档），已整体撤除。原因是归属语义不成立：

- **知识库有 `CreatorID`，但 API Key 路径下它是空的。** WeKnora 在 API Key 认证时挂一个合成的
  `system-<tenantID>` 用户，并**刻意跳过**写入 `CreatorID`（`internal/application/service/knowledgebase.go`），
  于是通过插件建的库是「租户所有」。而 `CreatorID == ""` 在所有权守卫里走的是 **Admin+ 分支**——
  成员在插件里建的库，回到 WeKnora 网页反而改不了。
- **文档根本没有 `CreatorID`。** 谁传的、谁删的，服务端不记录。
- 删除是不可逆的异步任务。没有归属的删除，等于一个无法追责的破坏性操作。

所以写入统一回到 WeKnora 控制台：那里有真实登录用户、真实 `CreatorID`、真实审计日志和完整 RBAC。
插件只负责**读**，只调用 Key 的 `retrieve` 能力。

但**现状是这把 Key 没有收窄**：它仍带 `ingest` / `manage_kbs`，只是插件已经不再调用任何写接口。
收窄是纯控制台运维动作（空间 → API Key），本次不作为交付条件；代价是这把 Key 一旦外泄，
爆炸半径仍是「全库可改可删」，而插件侧的只读约束只挡误用、挡不住直接拿 Key 打 API。

要把写入拿回来，前置条件是先设计归属：外部身份 → 本地用户的映射、`CreatorID` 的写入规则、
以及删除的审计链。在这些定下来之前，任何「能跑但说不清谁干的」写入都是负债。

## 配置（组织级，成员零配置）

连接设置属于**组织**，不属于个人：一条记录服务全体成员，键为 `org_<organizationId>`，
不含 `principalId`。管理员配一次，成员打开即用，不需要各配一遍。

| 谁 | 能做什么 |
|---|---|
| `owner` / `admin` | 读写：服务地址、默认知识库、API Key、超时 |
| `member` | 只读继承；面板显示「由组织统一维护」，输入框禁用 |

角色来自 `ctx.workdshIdentity.membership(orgId, principalId).role`。这不是纯 UI 约束：
**允许成员改 `baseUrl`，等于允许成员把地址指向自己的服务器并收走服务端发过去的 Key**，
所以非管理员写入在服务层直接抛 `knowledge/forbidden`（HTTP 403）。

面板「设置」中填写：服务地址、默认知识库（可选）、API Key（提交后写入凭据服务，不再回显）。
默认知识库只用于检索兜底（未在会话里绑定、也未选中某个库时用它）。

读取不会落库：未保存过配置时按「装配参数 → 环境变量 → 常量」实时合成，
否则第一个打开面板的成员会把当时的 `WEKNORA_BASE_URL` 固化下来，之后改部署配置就不生效了。

升级说明：v1 的 `connections` 记录是 per-member 的（`<org>_<principal>`），升级后不再被寻址。
schema 仍能解析它（`knowledgeStateStoredSchema` 是 v1+v2 联合），因为 `storageDomain.open`
会校验表内每一条记录——不兼容的 schema 会让整个插件启动失败，而不只是那条记录读不到。
两个成员当初可能填了不同地址，没有唯一值可迁移，所以由管理员重新确认一次。

也可以完全用环境变量启动：

```bash
WEKNORA_BASE_URL=http://127.0.0.1:18081 \
WEKNORA_API_KEY=sk-... \
dsh web --profile <profile>
# 可选：WEKNORA_API_KEY_REF=MY_KEY 使用自定义凭据引用名
```

默认值：`baseUrl = http://127.0.0.1:18081`，`apiKeyRef = WEKNORA_API_KEY`，`timeoutMs = 15000`。

### 部署侧的 Key 只需要 `retrieve`

插件只读，因此这把组织级 Key 的最小能力集就是 `retrieve`。**不要**给它 `ingest` / `manage_kbs`：
插件永远不会用到，而一旦泄露，多出来的能力就是别人的写权限。

读取能力校验在 `roleOf` / `requireManage` 上：只有 `owner` / `admin` 能改连接设置，
`member` 只读继承。注意这层判断保护的是**凭据不被指向他处**，不是内容写权限——
内容写权限已经不在插件这一侧存在了。

## 开发

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
cd apps/web
corepack pnpm --filter workdsh-plugin-knowledge typecheck
corepack pnpm --filter workdsh-plugin-knowledge build
corepack pnpm --filter workdsh-plugin-knowledge test           # 本地 HTTP stub 单测
corepack pnpm --filter workdsh-plugin-knowledge test:live       # 真实 WeKnora 只读契约
```

构建产物：`dist/index.js`（Host，ESM）、`dist/client.browser.js`（Client，`window.__ModuleLoader__` 包装）。
Client bundle 由 `apps/web/scripts/build-knowledge.mjs`（esbuild）生成，官方 client 包与 React 外置。

## 安装到隔离 Profile

`cordis.patch.yml` 会 `insert` 一个 `workdsh-knowledge` 插件条目，Host 侧注册
`workdshKnowledge` 服务 + `/api/workdsh-knowledge` 传输端点 + 五个 Agent 工具。
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
node scripts/verify-knowledge-reference.mjs "<login-url-with-token>"  # P3：@知识库 菜单 / chip / Session 绑定写入与读回
node scripts/verify-knowledge-wiki.mjs "<login-url-with-token>"        # P6.2：图标区隔 / 仅 wiki 标注 / 问句命中 / 展开 wiki 页（10 项）
node scripts/verify-knowledge-wiki-agent.mjs "<login-url-with-token>"  # P6.2：Agent 走 wiki 检索并给出处
node scripts/verify-knowledge-settings.mjs "<login-url-with-token>"   # P7：组织级连接设置（读写往返 / 角色）
```

live 契约检查（不经浏览器，直连 REST）：

```bash
node tests/live-search.mjs   # 不可检索库返回 0 条不报错；可检索库返回带出处命中
```

验收脚本全部只读，不会创建或删除任何知识库与文档，因此不会改动 能源知识库 / 新型电力系统。

> 已实测的本机变通：若 `dsh plugin --profile kbtest install/add` 在非 TTY 环境因
> `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 或 copied lockfile 的
> `minimumReleaseAge` 供应链策略中止，可把同一 tgz 解包到
> `kbtest/node_modules/workdsh-plugin-knowledge`（`tar xzf <tgz> --strip-components=1`），
> 并在其 `node_modules` 下用符号链接指向 Profile 已有的 `@deepseek-ai/*` 与 `zod`；
> 这不会改变安装字节，只替代 pnpm 的链接步骤。

## 边界与风险

- **只读**：插件不提供任何写入入口（建/改/删知识库、上传、重新解析、删除文档）。
  需要导入或清理内容请到 WeKnora 控制台，那里有真实登录用户与审计。理由见「为什么不提供写入」。
- **传输层只读**：`WeKnoraClient` 只有 GET / POST(检索)，`HttpMethod` 类型即 `'GET' | 'POST'`，
  单测固定断言 `putJson` / `deleteJson` / `postMultipart` / `postJson` 不存在——写入不可能被未来代码顺手加回来。
- **解析状态轮询**：文档列表/详情在存在 pending/processing 文档时每 4 秒静默刷新；
  解析失败展示 `error_message`，需到 WeKnora 控制台重新解析。
- **preview 端点**返回原始文件字节，插件只取 HTTP Range 前 4KB；文本类文件直接展示原文，
  DOCX/PDF/PPTX 等显示「已解析分块拼接」的文本预览。
- `knowledge_read` 仅在前 10 页 × 100 块内定位字符偏移；超长文档后续内容需调整 offset。
- 与「资料库」无数据同步；两者入口并存。
