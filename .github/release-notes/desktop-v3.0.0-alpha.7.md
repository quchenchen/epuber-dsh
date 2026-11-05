# EpuberDSH Desktop 3.0.0-alpha.7

本版把底座从 `0.2.2-alpha.2`（配 0.2.1 系宿主）整体升到 **DeepSeek Harness `0.2.2-rc.1`**，并确立一条硬规则：**随包 DSH 包版本 = 官方桌面产物版本**。这条规则带来一个直接后果——**本版不提供 macOS Intel 安装包**，原因见下。

## 底座升级

- **npm 包全体对齐 `0.2.2-rc.1`**：预检覆盖 334 个包，全部已发布，无缺失、无失效 override。
- **Cordis 全栈同步**：Core `4.1.0`、Loader `1.1.0`、Include `1.1.0`、Group `1.1.0`、Timer `1.2.0`。此前仓库把 Cordis 钉在 `4.0.6-alpha.1`，与 rc.1 的要求（`~4.1.0`）不一致，继续沿用会造成两套运行时并存。
- **官方 Web 客户端清单重算**：`profiles/shared/official-web-clients.json` 按 rc.1 重新生成，74 个官方客户端，来源指纹全部更新。
- **原生工作台框架补丁重新锚定**：`dsh-client-ui-conversation` 的 `lib/client.js` 在 rc.1 有变化，但两处补丁锚点仍各命中一次，补丁语义不变；仅原始/补丁后 SHA-256 重算。
- **上游值得注意的变化**：最低 Node.js 提升到 **24.9**（随包 Node 为 24.21.0，满足要求）；PTC 工具执行拆为按 Agent 作用域的插件、`tools.mode` 迁移（本项目未使用，无影响）；官方组合包列表改由 `@deepseek-ai/dsh-official-bundles` 导出；Windows 安装器绘制与发布者名称修复；桌面启动故障可获取诊断报告；远程连接默认启用 WebSocket 压缩。

## 一条新规则：包版本必须等于产物版本

此前允许「新包 + 旧宿主」（例如 `0.2.2-alpha.2` 包配 `0.2.1-rc.5` 宿主）。这版起不再允许：每个要发布的目标，其官方桌面产物版本必须与 npm 包版本一致。

规则落在三处：`upstream.json` 的 `heldTargets`（写明暂缓目标与原因）、`scripts/verify-desktop-dsh-alignment.mjs`（发布前强制校验）、`scripts/package-desktop-release.mjs`（暂缓目标直接拒绝打包，只有显式设置 `EPUBERDSH_ALLOW_HELD_TARGET=1` 才能用于本地调试）。

**macOS Intel 因此暂缓**：`dsh-v0.2.2-rc.1` 没有发布 Intel 桌面构建，官方 mac-x64 源仍停在 `0.2.1-rc.4`。本版 CI 的 macOS 矩阵只保留 Apple Silicon。Intel Mac 请继续使用 3.0.0-alpha.6，待官方发布匹配产物后补上。

## 验证

- 升级预检：334 个包全部已发布；三平台官方 feed 逐一核对，mac-x64 明确不在候选版本。
- 两个新产物的 SHA-512 由本地重算，与官方 feed 声明逐字节一致；产物内 `runtime.json` 的 Node 24.21.0 / Python 3.12.14 / pnpm 11.28.5 与锁定值一致。
- Web 与全部插件按 rc.1 重新构建通过；14 个自有包打包为 DSH 0.2.2-rc.1 候选。
- 运行时装配通过：`--dump-config` 正常生成配置，7 个默认产品包（连接器、专家、知识库、资料库、项目、技能、工作台）全部就位，Office / Activity / Quality Analysis 三个外置插件未随包。
- 补丁与官方包解析测试 4 项通过，发版脚本测试 22 项通过，版本对齐门禁通过。

本机为 Intel Mac，因此上述装配验证用的是「rc.1 包 + 0.2.1-rc.4 宿主」的组合；实际发布的 Apple Silicon 与 Windows 组合由 CI 在对应真机上构建验证。

## 下载与升级

- Windows x64：`EpuberDSH-3.0.0-alpha.7-x64-Setup.exe`。
- macOS Apple Silicon：`EpuberDSH-3.0.0-alpha.7-arm64.dmg`。
- macOS Intel：本版不提供，请使用 3.0.0-alpha.6。
- 企业连接继续独立提供 `epuberdsh-enterprise-connection-0.1.0-alpha.2.tgz` 和 ZIP，基础安装包不预装企业账号与协作插件。
- 下载后可依据 `SHA256SUMS` 核对完整性。本次 macOS DMG 未签名。

当前产品仍为 Alpha。升级前请备份本地配置和数据。第三方插件仍须满足当前 DSH 版本要求。

开源地址：[github.com/quchenchen/epuber-dsh](https://github.com/quchenchen/epuber-dsh)
