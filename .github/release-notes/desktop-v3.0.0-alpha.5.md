# EpuberDSH Desktop 3.0.0-alpha.5

本次修复 **Windows 安装版无法启动** 的问题：安装完成后启动会提示「本机运行已停止 / 官方 DSH 未能完成启动」，并报缺少 `@deepseek-ai/cosmokit` 等运行依赖。macOS 版不受影响。此前 Windows 安装过 3.0.0-alpha.4 的用户请直接升级到本版本。

## 问题原因

Windows 安装包由 7-Zip 压缩后交给 NSIS 释放，而 7-Zip 在打包时会把 pnpm 的符号链接**解引用成真实副本**。一个包的依赖原本挂在它同级的 `node_modules` 链接上，链接被解引用丢弃后，随包运行时看起来文件齐全，实际无法解析依赖：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/cosmokit'
    imported from .../profiles/epuberdsh/node_modules/@deepseek-ai/cordis/lib/index.js
```

macOS 的 DMG 保留符号链接，因此同一份代码在 macOS 上正常。这个故障只在用户的安装目录里出现，构建机上的 `win-unpacked` 目录始终是好的——所以此前的 Windows 打包检查虽然通过，用户仍然无法启动。

## 修复

- **Windows 运行时改为无链接的 hoisted 布局**：随包 Profile 不再依赖任何符号链接，安装后每个依赖都是真实目录。同时把最深路径从 301 个字符降到 174 个字符，避免在 `%LOCALAPPDATA%` 下接近 Windows 260 字符上限。
- **打包阶段硬校验**：Windows 运行时准备完成后若仍存在链接，构建直接失败，不再产出不可启动的安装包。
- **新增「装完能启动」的发布门禁**：Windows 打包后会把生成的 NSIS 安装包静默安装到临时目录，再在**安装后的目录**里装配一次运行时，逐一核对技能市场、插件市场与 7 个产品包，任何缺失都让构建失败。此前的检查只验证未打包的 `win-unpacked`，不覆盖用户实际拿到的安装结果。

## 验证

- 用 3.0.0-alpha.4 的 Windows 安装包复现了用户报错：解出包内运行时装配得到完全相同的 `Cannot find package '@deepseek-ai/cosmokit'`。
- 改为 hoisted 布局后，同一装配流程在本地通过：1327 行配置正常生成，`skillhub`、`dsh-market` 以及 `epuberdsh-installation-probe`、`identity-local`、`access`、`audit`、`workbenches` 全部就位，Office、Activity、Quality Analysis 三个外置插件未随包。
- 包内 Profile 的符号链接从 3988 个降到 0 个（仅剩 `.bin` 下的可执行垫片）。

## 下载与升级

- Windows x64：`EpuberDSH-3.0.0-alpha.5-x64-Setup.exe`。
- macOS Apple Silicon：`EpuberDSH-3.0.0-alpha.5-arm64.dmg`。
- macOS Intel：`EpuberDSH-3.0.0-alpha.5-x64.dmg`。
- 企业连接继续独立提供 `epuberdsh-enterprise-connection-0.1.0-alpha.2.tgz` 和 ZIP，基础安装包不预装企业账号与协作插件。
- 附件名称带构建平台前缀；下载后可依据 `SHA256SUMS` 核对完整性。本次 macOS DMG 未签名。

当前产品仍为 Alpha。升级前请备份本地配置和数据。第三方插件仍须满足当前 DSH 版本要求。

开源地址：[github.com/quchenchen/epuber-dsh](https://github.com/quchenchen/epuber-dsh)
