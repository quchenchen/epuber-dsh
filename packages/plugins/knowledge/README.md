# workdsh-plugin-knowledge

WorkDSH 的「知识库」一级能力（P1 只读版）。Host 通过 WeKnora REST `/api/v1` 直连知识库服务，
Client 提供原生面板：知识库列表 → 文档列表（解析状态）→ 文档详情（预览文本 + 分块）→ 混合/语义/关键词检索。

> 状态：`0.1.0-alpha.1`，**只读闭环**。与现有「资料库」(`workdsh-plugin-library`) 并存，不修改其行为。
> 不做上传、重建索引、删除等写操作（P2）。

## 能力

| 层 | 内容 |
|---|---|
| Host 服务 | `src/services/weknora-client.ts`（fetch、`X-API-Key`、超时/重试、错误归一化、分页）、`src/services/knowledge-service.ts`（KB/文档/预览/分块/检索） |
| 配置存储 | storage domain `workdsh_knowledge`：`baseUrl`、默认 KB、凭据引用、超时；API Key 值不入库 |
| 凭据 | 通过 `ctx.credentials` 的引用保存（默认引用 `WEKNORA_API_KEY`），每个操作解析一次；只写不读、不进日志 |
| Agent 工具 | `knowledge_list_kbs`、`knowledge_list_documents`、`knowledge_search`、`knowledge_read`，检索/读取结果都带出处（`knowledge_title`、`knowledge_id`、`chunk_id`、`knowledge_base_id`） |
| Client | `main` 槽位 key `workdsh-knowledge` + `sidebar.panellist` 一级入口「知识库」，使用 Harness 原生控件与 `workdsh-ui`，跟随主题 |

## 使用的 WeKnora REST 契约

| 能力 | 方法 | 路径 |
|---|---|---|
| 知识库列表 / 详情 | GET | `/api/v1/knowledge-bases`、`/api/v1/knowledge-bases/:id` |
| 文档列表 | GET | `/api/v1/knowledge-bases/:id/knowledge?page=&page_size=` |
| 文档详情（含 `parse_status` / `error_message`） | GET | `/api/v1/knowledge/:id` |
| 原始文件预览 | GET | `/api/v1/knowledge/:id/preview`（用 `Range` 只取前 4KB） |
| 分块列表 | GET | `/api/v1/chunks/:knowledge_id?page=&page_size=` |
| 混合/语义/关键词检索 | POST | `/api/v1/knowledge-bases/:id/hybrid-search` |

响应外层一般为 `{ success, data }`；列表分页字段（`page` / `page_size` / `total`）与 `data` 同级，
`weknora-client.ts` 的 `readPage` 同时兼容数组、`{data:[]}` 与带分页三种形状。
语义检索 = `disable_keywords_match: true`，关键词检索 = `disable_vector_match: true`。

## 配置

面板「设置」中填写：服务地址、默认知识库（可选）、API Key（提交后写入凭据服务，不再回显）。

也可以完全用环境变量启动：

```bash
WEKNORA_BASE_URL=http://127.0.0.1:18081 \
WEKNORA_API_KEY=sk-... \
dsh web --profile <profile>
# 可选：WEKNORA_API_KEY_REF=MY_KEY 使用自定义凭据引用名
```

默认值：`baseUrl = http://127.0.0.1:18081`，`apiKeyRef = WEKNORA_API_KEY`，`timeoutMs = 15000`。

## 开发

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
cd apps/web
corepack pnpm --filter workdsh-plugin-knowledge typecheck
corepack pnpm --filter workdsh-plugin-knowledge build
corepack pnpm --filter workdsh-plugin-knowledge test        # 本地 HTTP stub 单测
corepack pnpm --filter workdsh-plugin-knowledge test:live   # 真实 WeKnora（需服务与凭据）
```

构建产物：`dist/index.js`（Host，ESM）、`dist/client.browser.js`（Client，`window.__ModuleLoader__` 包装）。
Client bundle 由 `apps/web/scripts/build-knowledge.mjs`（esbuild）生成，官方 client 包与 React 外置。

## 安装到隔离 Profile

`cordis.patch.yml` 会 `insert` 一个 `workdsh-knowledge` 插件条目，Host 侧注册
`workdshKnowledge` 服务 + `/api/workdsh-knowledge` 传输端点 + 四个 Agent 工具。
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
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
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
node scripts/verify-knowledge-isolated.mjs "<login-url-with-token>"   # 11 项 GUI 检查 + 截图
node scripts/verify-knowledge-tool.mjs "<login-url-with-token>"       # Agent 调用 knowledge_search 并核对出处
```

> 已实测的本机变通：若 `dsh plugin --profile kbtest install/add` 在非 TTY 环境因
> `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 或 copied lockfile 的
> `minimumReleaseAge` 供应链策略中止，可把同一 tgz 解包到
> `kbtest/node_modules/workdsh-plugin-knowledge`（`tar xzf <tgz> --strip-components=1`），
> 并在其 `node_modules` 下用符号链接指向 Profile 已有的 `@deepseek-ai/*` 与 `zod`；
> 这不会改变安装字节，只替代 pnpm 的链接步骤。

## 边界与风险

- P1 只读：不提供上传/删除/重建索引；「新建知识库」按钮禁用。
- `preview` 端点返回原始文件字节；本插件只取 HTTP Range 前 4KB。文本类文件直接展示原文，
  DOCX/PDF/PPTX 等二进制文件展示「已解析分块拼接」的文本预览。
- 检索默认使用面板当前知识库；工具未指定 `kb_id` 时使用默认知识库，租户只有一个知识库时自动选择。
- 一个知识库超过 1000 个分块时，`knowledge_read` 只在前 10 页（每页 100 块）内定位字符偏移。
- 与「资料库」无数据同步；两者入口并存。
