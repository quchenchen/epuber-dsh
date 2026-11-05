# EpuberDSH Desktop 3.0.0-alpha.8

本版恢复到三平台齐发：**macOS Intel 回来了**。上一版因为 `dsh-v0.2.2-rc.1` 没有 Intel 桌面构建而暂缓 Intel，那是把上游的缺口变成了我们的缺口。现在 Intel 运行时由**同一版本的官方组件在本地组合**而成，包版本仍然等于 DSH 版本，没有降级、没有「新包配旧宿主」。

## Intel 运行时怎么来的

官方 mac-x64 源停在 `0.2.1-rc.4`，官方 mac-arm64 源是 `0.2.2-rc.1`。两个归档都是锁定并逐字节校验的：

| 部分 | 来源 | 理由 |
| --- | --- | --- |
| CLI 资源、Office 技能、pnpm | `0.2.2-rc.1` Apple Silicon 构建 | 纯 JavaScript 与数据，与架构无关，必须与本版 DSH 一致 |
| Node 24.21.0、Python 3.12.14 | `0.2.1-rc.4` Intel 构建 | 机器码，只能取同架构构建；该构建携带的版本与本版锁定的 `primaryRuntime` 完全一致 |

所有 DSH 代码都来自 `0.2.2-rc.1`，Intel 侧只补机器码，因此不存在两套 DSH 版本并存。

官方运行时里还有一个 `cli/link-entry` 原生链接器（用于安装 `dsh` 命令），官方同样只提供各架构版本；它随发行缓存一起准备，取自 Intel 构建。当前外壳并不安装该命令，这个文件不进安装包，本次也顺手清掉了安装包里更早残留的一份旧 CLI 目录。

## 机制上的保证

- `upstream.json`：暂缓机制（`heldTargets`）整体移除，改为 `composed`。每个目标要么是官方同版本产物，要么写明两个来源归档（`binaries` + `payload`），二者都锁 URL、体积、SHA-512。
- 来源规则由代码强制：架构二进制必须来自目标本身，载荷必须来自本版本，跨平台载荷直接被拒；如果某天官方发布了同版本 Intel 构建，组合配置会被拒绝并提示改用官方产物（避免配置腐烂）。
- 装出来的运行时多一道**架构检查**：遍历 Node、Python、CLI 三棵真正会被加载的树，读取 Mach-O / PE 头，任何一个可执行文件架构不符即中止。pnpm 自带的各平台预编译件与 pip 自带的 Windows 测试 exe 不参与判定——它们不会被加载，上一轮误报就是被这道判定抓出来的。
- `runtime.json` 由锁定版本与载荷摘要生成，`payloadDigest` 用「相对路径 + 每个文件 SHA-256」的清单哈希，缓存复用时会重新计算比对，半成品或篡改过的载荷无法冒充已就绪运行时。
- 来源记录（`.epuberdsh-source-artifact.json`）升到 schema 2：写明两个来源归档的 target、version、URL、体积、SHA-512，任一字段被改都会在打包前报 provenance mismatch。

## 验证

- 本机 Intel 上完成真实组合：`mac-x64` 运行时由两个官方归档组装，产物内 `node --version` = 24.21.0、`python3 --version` = 3.12.14、`pnpm --version` = 11.28.5，`cli/link-entry` 为 x86_64。
- 架构检查、载荷摘要、来源记录三项在组合流程内自校验；篡改测试覆盖来源归档字段与运行时元数据。
- 单元测试 8 项覆盖：归档锁定、组合布局（二进制/载荷分置、链接器跟随架构）、拒绝猜测版本与跨平台载荷、架构守卫的误报边界。
- 版本对齐门禁输出：`mac-arm64=0.2.2-rc.1 (official)`、`mac-x64=0.2.2-rc.1 (composed: payload 0.2.2-rc.1 + mac-x64 binaries 0.2.1-rc.4)`、`win-x64=0.2.2-rc.1 (official)`。
- CI 的 macOS 矩阵恢复为 `[x64, arm64]`，两个架构都在真机上构建并执行打包冒烟。

## 下载与升级

- Windows x64：`EpuberDSH-3.0.0-alpha.8-x64-Setup.exe`。
- macOS Apple Silicon：`EpuberDSH-3.0.0-alpha.8-arm64.dmg`。
- macOS Intel：`EpuberDSH-3.0.0-alpha.8-x64.dmg`。
- 企业连接继续独立提供 `epuberdsh-enterprise-connection-0.1.0-alpha.2.tgz` 和 ZIP，基础安装包不预装企业账号与协作插件。
- 下载后可依据 `SHA256SUMS` 核对完整性。本次 macOS DMG 未签名。

当前产品仍为 Alpha。升级前请备份本地配置和数据。第三方插件仍须满足当前 DSH 版本要求。

开源地址：[github.com/quchenchen/epuber-dsh](https://github.com/quchenchen/epuber-dsh)
