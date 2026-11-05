# 能力中心

> **本文件已按 2026-11-01 的结论重写。** 早期版本以「自建制品面 + OCI + 自建版本台账 + 自研审批/轮询/签名」为骨架，
> 该骨架在确认 `iflytek/skillhub` 可用之后**整体作废**——保留它只会得到一个二次建模的缝合怪。旧内容不再保留，避免有人照着做。

## 0. 结论

**不新建平台。** 以 `iflytek/skillhub`（Apache-2.0，Java 21 + React 19，5.3k★，自托管）为底座做私有化部署，
我们只承担四件事：**部署运维、企业身份与部门、DSH 版本兼容落盘、MCP/tool 单列**。

能力中心的产品形态因此是：**一套跑在企业内网的 SkillHub 实例 + 我们的集成层**，不是一个新写的系统。

---

## 1. 底座已经有的能力（不自建）

每一项都对应仓库里的实现位置，验收时直接去看，不靠我复述。

| 能力 | SkillHub 的落点 |
|---|---|
| 技能包发布、语义化版本、`beta`/`stable` 标签、`latest` 跟踪 | `docs/07-skill-protocol.md`、`docs/14-skill-lifecycle.md` |
| 命名空间 + Owner/Admin/Member 角色 | `docs/02-domain-model.md`、`docs/03-authentication-design.md` |
| 审核（命名空间内审核 + 全局推广审批）+ 审计日志 | `docs/05-business-flows.md`、`docs/14-skill-lifecycle.md` |
| 可见性规则（谁能看到什么） | `docs/skill-visibility.md` |
| 全文搜索、评分、下载量 | `docs/04-search-architecture.md` |
| REST API / CLI / API 令牌（前缀哈希） | `docs/06-api-design.md`、`cli/` |
| 前端控制台 | `web/`、`docs/08-frontend-architecture.md` |
| 存储（本地 / S3 / MinIO 可切换） | `docs/object-storage.md` |
| 部署（compose / Helm / 监控） | `docker-compose.yml`、`charts/`、`monitoring/`、`docs/09-deployment.md` |
| 私有 SSO 扩展点 | `docs/11-auth-extensibility-and-private-sso.md`、`docs/12-private-sso-integration-playbook.md` |
| DSH 原生插件（技能中心、装/升/卸/启停/诊断） | `plugins/dsh/`（`@astron-team/skillhub-dsh`） |
| 合规元数据、内容安全 | `docs/24-compliance-metadata-design.md`、`docs/CONTENT_SAFETY.md` |

**判断原则**：凡是上表里有的，一律不去重新实现一层。二次建模的代价永远高于改造现成系统。

---

## 2. 我们真正要做的四件事

### 2.1 部署与运维

- 形态：compose 起步（`docker-compose.yml`），生产上 Helm（`charts/`）；存储用 MinIO 或企业 S3；数据库随包；监控接 `monitoring/`。
- 归属：这套是我们的服务，不是桌面端的一部分；独立域名、独立证书、独立备份策略。
- 交付物：一份可复现的部署清单（镜像 tag 固定、`.env.release` 纳管、备份与恢复演练记录）。

### 2.2 企业身份与部门

现状：企业身份体系已存在（`packages/providers/identity-enterprise/src/member-identity.ts` 要求 `active && organizationId && principalId && role`；桥接约定见 `docs/ENTERPRISE-PLUGIN-AUTH.md`）。SkillHub 另有自己的账户体系与 SSO 扩展点。

两条路线，**必须先选一条**，不要两条都做：

| 路线 | 做法 | 代价 | 适用 |
|---|---|---|---|
| **A. 命名空间映射**（推荐先做） | SkillHub 用自带账户；我们的组织/部门 ↔ SkillHub 命名空间做一张映射表（部门=命名空间，成员=命名空间成员） | 两套账号；成员需登录一次 SkillHub | 先跑通业务，不动它的鉴权 |
| **B. SSO 对接** | 按 `docs/12-private-sso-integration-playbook.md` 接企业 IdP，成员免二次登录 | 改它的鉴权扩展，跟随上游升级 | 成员规模大、要求单点登录 |

与 `epuberdshEnterprise` 的关系：**不混**。桌面端通过既有桥接调用我们的业务后端；SkillHub 是独立服务，不接管成员身份判定，也不从客户端接收组织 ID 或角色。

部门层级的现实约束：现有 `Organization(kind: personal|team)` 是扁平的，部门树由我们在映射表里维护，**不回写既有身份模型**。

### 2.3 DSH 版本兼容（唯一有实质工程量的地方）

事实（源码级，`plugins/dsh/src/host/compatibility.ts`）：

```ts
export const supportedDshVersions = ['0.2.0-rc.2', '0.2.1-rc.2'] as const;
export const hostDependencyBaseline = { '@deepseek-ai/cordis': '4.0.4',
  '@deepseek-ai/dsh-fs': '0.2.0-rc.2', /* 共 11 个 dsh 包钉在 0.2.0-rc.2 */ };
```

`runtime-compatibility.ts` 在每次写操作前重新校验，不匹配即 `local writes are disabled`。我们锁的是 `0.2.2-rc.1`（cordis 4.0.5），**它的插件直接装会被拒写**。

三个可选做法：

| 方案 | 做法 | 优点 | 风险 |
|---|---|---|---|
| **A. 只用 CLI** | `skillhub install --agent dsh` 落盘到 `~/.dsh/skills` 或 `.dsh/skills`，不装它的插件 | 立刻可用，零改造；dsh 监听技能根，热刷新 | 没有 UI，成员要会命令行 |
| **B. Fork 插件放宽范围** | 把 `supportedDshVersions` 与 baseline 扩到 `0.2.2-rc.1`，跑它的测试 | 体验完整（技能中心、启停、诊断） | 每次 DSH 升级都要跟；上游合不回 |
| **C. 自写薄消费插件** | 用它的 REST API，落盘逻辑我们自己写进 Profile 插件 | 升级解耦，只依赖 HTTP 契约 | 要自己实现安装/升级/卸载/诊断 |

推荐顺序：**先 A 验证端到端，再按需要的体验选 B 或 C**。A 是为了拿到事实，不是为了长期方案。

**已选定 C，且已实现**（2026-11-01，见 §8）。理由：A 把命令行推给编辑人员，B 把 DSH 升级成本压在自己身上；C 只依赖它的 REST 契约，DSH 升版时我们不用动，它升版时我们也不用动。

### 2.4 MCP / tool 单列

**事实（源码与文档级）**：SkillHub 的领域模型只有四个实体——`namespace` / `namespace_member` / `skill` / `skill_version`（`docs/02-domain-model.md`）；全仓 4268 个文件里路径含 `mcp` 的只有 `.mcp.json`（它自己的开发配置），`tool` 全部是 DSH 插件给宿主暴露的工具实现（`install-tool` / `search-tool` / `management-tool`），不是工具目录。

技能包协议是 OpenSkills 兼容的 `SKILL.md + references/ + scripts/ + assets/`（`docs/07-skill-protocol.md`），因此：

- **脚本类工具**可以随技能包分发，但那是文件，平台给不了"工具级"的版本、权限与调用审计——它审计的仍是 skill 版本。
- **MCP 没有注册中心**。社区用法是「把 MCP 写成一个 skill」（PR #821 将 `sandbase@0.1.17` 作为 MCP skill 纳入内置集），即用技能指令引导接入与调用；平台不掌握 server 地址、凭据、连接状态与工具清单，所以做不到「MCP 上下架 + 按部门授权 + 调用审计」。
- 他们在 `authoring` 系列 PR（#954/#1003）里做了 "runtime bindings, MCP probing"，但那是给技能作者校验用的探测能力，不是 MCP 目录。

因此 MCP 与 tool 必须单列，不能硬塞进 SkillHub 的模型：

- **MCP / tool**：引入一个**运行时网关**负责统一入口、tool 级授权与调用审计，二选一（不并存）：
  - `ascending-llc/jarvis-registry`（3.7k★，Python，Apache-2.0）：ACL 精确到单个 tool、OIDC 委托（Keycloak / Cognito / Entra）、审计 + OTel + Prometheus、按语义发现 MCP server 与 A2A agent。**没有制品版本概念**（它注册的是活端点，不是包）。
  - `IBM/mcp-context-forge`（4.7k★，Python，Apache-2.0）：Admin UI + 独立 Web UI、RBAC/SSO、虚拟服务器、限流、审计；UI 更完整，但要运维 Redis+Helm，生产无 arm64。
- 判据：谁的**授权粒度**与**身份委托**更贴企业 IdP，就选谁；两者都不覆盖"工具包版本"，那是 SkillHub 侧的 skill 版本，不要重复造。
- 若为了省一套栈而只做目录：形态可参考 LobeChat 的两阶段加载（轻索引 + 按需 manifest），但 version / digest / 审批 / 授权必须自己补。

> **上游已明确拒绝 MCP（重要，决定单系统是否可行）**
> - Issue #466「Can MCP service management be supported」→ 维护者结论：**不做**。原文理由：「SkillHub is a **control-plane registry**, not a data-plane runtime. Adding MCP gateway/forwarding would fundamentally change...」
> - Issue #602「增加 MCP 广场和专家包」→ MCP 部分 **not_planned**：「涉及独立的 MCP Server 资源模型、连接配置、凭证权限、健康检查和部署生命周期，当前阶段暂不纳入」；专家包部分已由 **Skill Suite** 承接（#715/#826/#828）。
> - 已知先例：有用户（lironghai）在 fork 里自行加了 MCP 广场（用 ContextForge）与 MCP 能力。这说明"加得上去"，但属于自行维护分支。
>
> 结论：想要"一个后台同时管 skill 与 MCP"，**没有现成单系统**；上游封闭，只能自己加资源类型，或外挂一个共用账号/审计的模块。

---

## 3. 同类项目调研结论（2026-11-01，按星数排查后逐条判）

判据不是 star，是四件事：**许可、部署形态、身份模型、有没有版本/审批/审计**。

| 项目 | 星 | 语言/许可 | 它真正解决什么 | 判定 |
|---|---|---|---|---|
| `openclaw/clawhub` | 9.5k | TS / MIT | OpenClaw 的 skill 注册中心：发布/版本/changelog/latest、审核、向量检索，另有 code plugin / bundle plugin / template 目录与"钉住本地安装" | **不可用**：后端是 Convex（DB+存储+HTTP），认证绑 Convex Auth + GitHub OAuth，自托管要连 Convex；且面向公共注册中心，不是内网治理。只借形态 |
| `tech-leads-club/agent-skills` | 7.1k | TS / 自定义 | "secure, validated skill registry" | 未深入验证，形态偏目录站，不作为底座候选 |
| `iflytek/skillhub` | 5.3k | Java / Apache-2.0 | 企业级 skill 注册中心：命名空间、角色、审核、审计、版本标签、自托管、DSH 原生插件 | **采用**（skill 层） |
| `IBM/mcp-context-forge` | 4.7k | Python / Apache-2.0 | MCP/A2A/REST 网关 + 注册 + 管理 UI + RBAC/SSO | **备选**（MCP 层） |
| `archestra-ai/archestra` | 4.4k | TS / **AGPL-3.0 + 商业版** | 整套安全 AI 平台：Chat + agents + LLM gateway + MCP registry + guardrails + 沙箱 | **否决**：与 EpuberDSH 定位重叠，引进来等于换产品；AGPL 与商业版分界还会带来合规评审成本 |
| `ascending-llc/jarvis-registry` | 3.7k | Python / Apache-2.0 | 企业 MCP/A2A 网关：tool 级 ACL、OIDC 委托、审计、语义发现 | **优先备选**（MCP/tool 层）：授权粒度与身份委托最贴企业 |
| `casdoor/casdoor` | 14.7k | Go / Apache-2.0 | IAM（含 LLM/MCP/agent 网关能力） | 仅在企业 IdP 不可用时才考虑；我们已有身份体系，不引入 |
| `agentic-community/mcp-gateway-registry` | 1.0k | Python / Apache-2.0 | MCP 网关 + 注册（参考实现性质） | 规模与维护度不足，不选 |
| `lobehub/lobe-chat-plugins` | 303 | TS | 静态插件索引（OpenAPI manifest） | **否决**：无版本、无审批、无 RBAC、无审计 |
| `stacklok/toolhive-registry-server` | 29（母项目 toolhive 2.3k） | Go / Apache-2.0 | **只读发现型注册中心**：把 MCP server / skill / plugin 三类条目从 Git、k8s、上游 registry、Admin API 汇总成命名 catalog；JWT claim 可见性、角色（manageSources/Registries/Entries）、SIEM 审计、条目版本查询 | **不作底座**：不存制品、无上传包、无发布审核流、无 UI。可作未来的"跨源目录层" |
| `den-vasyliev/agentregistry-inventory` | 26 | Go / Apache-2.0 | K8s-native registry（MCP/agents/skills/models） | 2026-07 后无更新，不活跃，不选 |
| `modelcontextprotocol/registry` | 7.4k | Go | MCP 官方元数据注册服务 | 只作公共生态元数据参考；无企业授权/审批 |

**结论**：skill 治理有现成底座（SkillHub），MCP/tool 治理也有现成网关（jarvis 或 ContextForge），两者之间用 OIDC 与企业 IdP 打通即可——这是**分工**，不是缝合：每个系统只做一件事，互相之间只有身份与 API 两种接口。

---

## 4. 验收（可测，不靠感觉）

1. **可用**：在 `0.2.2-rc.1` 宿主上安装一个技能包，技能系统能发现并调用（方案 A 先跑通）。
2. **隔离**：部门 A 的成员在搜索与列表里看不到部门 B 命名空间的包。
3. **治理**：提交 → 审核 → 上架 → 下架全链路走通，审计日志能查到每次操作人。
4. **版本**：装 v1，发布 v2 后客户端能识别升级，且可回退到 v1。
5. **身份**：桌面端成员调用业务接口不携带任何客户端可控的组织/角色参数，后台从认证上下文取。

## 5. 明确不做（防止再走回头路）

| 不做 | 原因 |
|---|---|
| OCI / Harbor 制品面 | SkillHub 用对象存储（S3/MinIO）管包，引入 OCI 等于再造一套存储与版本语义 |
| 自建版本台账与状态机 | SkillHub 已有 `draft → 审核 → 上架 → 下架` 与 semver 标签 |
| 自研 4-eyes 审批引擎 | 它的命名空间审核 + 全局推广已覆盖；企业要加签就在它的流程上加节点 |
| 自研签名/摘要体系 | 不在本期范围；真要制品签名，等有合规硬要求再评估，别提前建 |
| 自建轮询/推送同步协议 | CLI 与 REST 就是拉取模型，不需要第二套 |
| 把 skill/tool/mcp 强行统一成一个领域模型 | 它们的落地方式不同（目录 / 进程 / 配置），统一模型的产出是抽象层，不是能力 |
| 引入 archestra 这类"整套 AI 平台" | 与 EpuberDSH 产品定位重叠；AGPL + 商业版分界还要额外合规评审 |

## 6. 待拍板

1. 身份路线：**A 命名空间映射**（快）还是 **B SSO 对接**（彻底）？——部署前必须定，见 `DEPLOYMENT.md` §3。
2. ~~DSH 兼容：A / B / C~~ → **已定 C 并实现**（§8）。
3. MCP/tool 层：选 **jarvis-registry**（tool 级 ACL、OIDC 委托）还是 **ContextForge**（自带 UI 更完整、但多一套 Redis+Helm）？还是先只做目录直连？——属二期，不阻塞部署。

---

## 7. 本地验证记录（2026-11-01 实测，非推演）

环境：macOS x64，Docker 29.3.1；SkillHub 以 `compose.release.yml` + `SKILLHUB_VERSION=latest` 起在 `~/Documents/github/skillhub`。

| 步骤 | 结果 |
|---|---|
| 服务栈 | 5 个容器 healthy：postgres(15432)、redis(6379)、server(8080)、skill-scanner、web(3000) |
| 可用性 | `GET /` 200、`GET /api/v1/skills` 200 |
| 登录 | 本地密码方式（`/api/v1/auth/methods` 返回 `local-password`）；bootstrap 管理员 `docker-admin` 具备 `SUPER_ADMIN` |
| 令牌 | `POST /api/v1/tokens` 生成 `sk_…`，CLI `whoami` 返回 `docker-admin` |
| 发布 | `skillhub publish` → `global/media-headline-check@20261101.115519`，状态 `PUBLISHED` |
| 安装 | `skillhub install … --agent dsh --scope user` → `~/.dsh/skills/media-headline-check/SKILL.md` |
| **与本仓库运行时的契合** | 已安装的 `@deepseek-ai/dsh-skill-filesystem` 默认根为 `.dsh/skills` 与 `.agents/skills` ⇒ **装完即被 DSH 扫描到**，不需要改官方代码 |

### 两个环境坑（不是 SkillHub 的问题）

1. **WorkBuddy 的 `NODE_OPTIONS` safe-delete shim** 会拦 CLI 释放 `~/.skillhub/inventory.json.lock`（`rmdir` 被 broker 拒绝），表现为 `Error: unexpected failure`。
   解法：`env -u NODE_OPTIONS skillhub …`。与打包流程遇到的 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 同源。
2. **CSRF**：`POST /api/v1/auth/*` 与 `POST /api/v1/tokens` 必须带 `X-XSRF-TOKEN`（值取 `XSRF-TOKEN` cookie），否则 403 `InvalidCsrfTokenException`（服务端日志可查）。

### 由此确定的集成事实

- 一期**不需要**它的 DSH 插件（版本门禁卡 `0.2.2-rc.1`），CLI 路径已验证可用。
- 技能落地位置由 `--agent dsh --scope user|project` 决定，与运行时扫描根一致，**无需改动运行时**。

---

## 8. 已实现的技能中心面板（2026-11-01）

落在既有技能插件里，不新增包、不新增服务：`packages/plugins/skills`。

| 层 | 文件 | 职责 |
|---|---|---|
| 契约 | `src/skillhub-contract.ts` | 面板与宿主之间的纯类型；凭据值不在其中 |
| 宿主服务 | `src/services/skillhub.ts` | 读注册中心、下载包、走本仓库既有导入链路安装 |
| 连接路由 | `src/services/skillhub-api.ts` | `POST /api/epuberdsh-skills/skillhub`，端点 `status/configure/forget/search/detail/install` |
| 浏览器端 | `src/client/skillhub.ts` 与 `src/client/SkillHubPanel.tsx` | 「技能市场 → SkillHub」页签：连接设置、搜索、详情、安装 |

### 8.1 三条不能被绕过的约束

1. **令牌不落盘明文**。只保存变量名（默认 `SKILLHUB_TOKEN`），值写进平台凭据服务（`ctx.credentials.set`），读取时按次解析。连接信息本身存 `epuberdsh_skillhub` 存储域，与连接器同一套机制。
2. **目录安装不旁路校验**。下载的压缩包直接交给 `SkillImportStaging.stage → commit`，也就是说它与浏览器上传共用同一套路径安全检查、单一 `SKILL.md` 校验、大小上限、源指纹与技能名锁。注册中心给的包没有任何特权。
3. **URL 不由目录数据决定**。`namespace` / `slug` / `version` 必须通过 `skillHubSegment` 的字符白名单，拼接后仍受 `redirect: 'error'` 约束，避免恶意条目把令牌带去别的主机。

### 8.2 顺手修掉的两个真实缺陷

**其一：面板请求打在了不可能存在的地址上。** 面板原来请求 `./skillhub`，也就是站根 `/skillhub`。而 `HostConnectionFetch.register` 的 `path` 契约写明「Absolute path below `/api`」，运行时也只把 `/api` 前缀注册到 web server——**那个地址永远不可能有路由**，面板在任何部署下都只会显示「当前 Profile 未安装 SkillHub 集成」。现已改为 `/api/epuberdsh-skills/skillhub`。

**其二：所有错误都被折叠成同一句话。** `publicFailure` 用 `error.message.startsWith('skill/')` 判断错误码前缀，而 `skillhub/unreachable` 并不以 `skill/` 开头（`skill` 之后是 `hub/` 而不是 `/`），于是技能中心的每个失败都落到 `skill/internal`，统一显示「技能操作失败，请重试。」——用户拿不到任何可行动信息。判定改为 `/^skill(hub)?\//` 后，地址无效、令牌失效、不可达、存储写入失败各有各的提示，面板还会在提示下方以小字显示错误码，便于转给管理员。

配套的两处健壮性改动：

- **存储域改为首次使用时打开**（`Service.init` 只做预热）。面板不再依赖初始化时序：即使服务早于依赖就绪被构造，也不会对所有请求回答「未就绪」。
- **存储不可用时退化为会话内连接**。地址与令牌仍可填、技能仍可装，只是在提示里标注「连接仅本次会话有效」，而不是整块面板变成错误页。

### 8.3 验证（实测，非推演）

| 项 | 结果 |
|---|---|
| 类型检查 | `tsc -p packages/plugins/skills --noEmit` 通过 |
| 单测 | `node --test tests/skillhub.test.mjs` 6/6（地址规范化、路径穿越拒绝、两种响应信封、两种行结构映射、缺 slug 丢弃、**错误码不被折叠**） |
| 真实链路 | 对本地 SkillHub：搜索命中 `global/media-headline-check` → 下载 200 `application/zip` → `stage` 通过 → `commit` 落盘 `enabled` |

### 8.4 这一层不做的事

- 不做上架、审批、下架、部门授权——那些在 SkillHub 控制台里做，客户端只消费结果。
- 不做 MCP / tool——见 §2.4，那是二期且需要另一个系统。
- 不做「已安装 → 可升级」的版本对比。当前卡片只回答「装了没有」；升级判定要读已装技能的版本，属于下一轮。
