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
| 配置存储 | storage domain `workdsh_knowledge`：`baseUrl`、默认 KB、凭据引用、超时；API Key 值不入库 |
| 凭据 | 通过 `ctx.credentials` 的引用保存（默认引用 `WEKNORA_API_KEY`），每个操作解析一次；只写不读、不进日志 |
| Agent 工具（读） | `knowledge_list_kbs`、`knowledge_list_documents`、`knowledge_search`、`knowledge_read`，结果带出处（`knowledge_title`、`knowledge_id`、`chunk_id`、`knowledge_base_id`） |
| Agent 工具（写） | `knowledge_upload`（上传 UTF-8 文本内容并等待解析）、`knowledge_reparse`、`knowledge_delete`（⚠️ 破坏性，必须 `confirm=true`） |
| Client | `main` 槽位 key `workdsh-knowledge` + `sidebar.panellist` 一级入口「知识库」，使用 Harness 原生控件与 `workdsh-ui`，跟随主题 |

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
| 混合/语义/关键词检索 | POST | `/api/v1/knowledge-bases/:id/hybrid-search` |

响应外层一般为 `{ success, data }`；列表分页字段（`page` / `page_size` / `total`）与 `data` 同级，
`weknora-client.ts` 的 `readPage` 同时兼容数组、`{data:[]}` 与带分页三种形状。
语义检索 = `disable_keywords_match: true`，关键词检索 = `disable_vector_match: true`。
文档删除是**异步任务**（返回 `task_id`），服务提供 `waitForDocumentDeletion` 轮询列表直到消失。

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
