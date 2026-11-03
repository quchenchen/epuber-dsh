# EpuberDSH Desktop 3.0.0-alpha.4

本次为品牌迁移后的首个版本：仓库与内部标识由 WorkDSH 统一为 EpuberDSH，知识库面板正式进入桌面默认产品清单，随包底座升级到官方最新发布的 DeepSeek Harness。基于已通过检查的 `main` 提交 `3eee1b44b52b4c600e69ad77faa1484197a60817`。

## 主要变更

- **品牌与仓库迁移**：包名、内部标识与文档由 workdsh 统一为 epuberdsh；产品名、开源地址与问题反馈入口不变。新增品牌样式 token 层（`--wd-*`，并桥接既有 35 个 `--dsw-alias-*` 名称），技能、连接器、项目、专家、知识库五个面板构图层统一接入，视觉表现不变。
- **知识库面板进入默认产品清单**：桌面默认个人 Profile 的产品包加入 `epuberdsh-plugin-knowledge`（6 → 7），随包发布清单同步增至 14 个（13 → 14）；安装冒烟校验的产品清单随之更新，实测安装包内知识库面板随产品一同提供。知识库的 `@` 引用分组以中文「知识库」命名。
- **技能面板修复**：内置技能不再渲染为禁用的灰色开关，改为显示「内置」标签，避免误以为可以关闭。
- **底座升级**：DSH Host、Client 和 SDK npm 包统一为 `0.2.2-alpha.2`；桌面二进制更新为 mac-arm64 `0.2.1-rc.5`、mac-x64 `0.2.1-rc.4`、win-x64 `0.2.1-rc.5`。rc.5 是 0.2.1 分支的热修复，版本号低于 npm 底座属正常；各平台均固定为官方最新发布并核对 SHA-512。

## 验证

- 发版提交的源码检查、企业插件和 macOS Apple Silicon / Intel 打包检查均已通过；Windows x64 打包检查随本次标签触发重新执行。
- 本地 macOS 冒烟安装包实测版本号 3.0.0-alpha.4，产品清单包含知识库在内的 7 个产品包。
- 本次版本通过标签触发重新构建，发行工作流还会核对版本、来源提交、随包运行时、企业插件来源及附件 SHA-256。自动检查不代表各平台全部真实交互均已验收。

## 下载与升级

- Windows x64：`EpuberDSH-3.0.0-alpha.4-x64-Setup.exe`。
- macOS Apple Silicon：`EpuberDSH-3.0.0-alpha.4-arm64.dmg`。
- macOS Intel：`EpuberDSH-3.0.0-alpha.4-x64.dmg`。
- 企业连接继续独立提供 `epuberdsh-enterprise-connection-0.1.0-alpha.2.tgz` 和 ZIP，基础安装包不预装企业账号与协作插件。
- 附件名称带构建平台前缀；下载后可依据 `SHA256SUMS` 核对完整性。本次 macOS DMG 未签名。

Desktop 与 Web 的 DSH Host、Client 和 SDK npm 包统一为 `0.2.2-alpha.2`。Intel 的 Node、pnpm、Python、Office 资源及预编译工具仍来自单独校验的官方归档，保留其真实元数据，不代表 DSH npm 底座回退。

当前产品仍为 Alpha。升级前请备份本地配置和数据。第三方插件仍须满足当前 DSH 版本要求。

开源地址：[github.com/techflag/workdsh](https://github.com/techflag/workdsh)
