# AI融媒中心 桌面打包（官方流水线）

基于官方 `deepseek-ai/deepseek-harness` 仓库 `apps/desktop`（tag `dsh-v0.1.5-rc.1`）的隔离快照，
经 `WORKDSH TEST PATCH` 补丁产出 **AI融媒中心.app 未签名本地测试版**（macOS arm64）。

**完整指南见 [docs/DESKTOP-PACKAGING.md](../../docs/DESKTOP-PACKAGING.md)**：用法、补丁用途表、
快照重建、Windows 说明与常见问题均以该文档为主体；本文件仅作脚本目录速查。

产物仅本机自用，**不可分发**；正式发布需停用未签名模式并具备 Apple Developer ID 与公证凭据。

## 快速使用

```bash
node scripts/desktop/pack-desktop.mjs                # 校验补丁 → build:desktop → electron-builder → 产物校验
node scripts/desktop/pack-desktop.mjs --restart      # 打包校验通过后重启应用
node scripts/desktop/pack-desktop.mjs --skip-build   # 只重跑 electron-builder（未改 apps/desktop 源码时）
node scripts/desktop/pack-desktop.mjs --check-only   # 只做前置检查
node scripts/desktop/pack-desktop.mjs --sync-patches # 快照补丁有改动时，同步到本目录存档

node scripts/desktop/build-desktop-icon.mjs          # 从品牌 SVG 重新生成 workdsh-icon.icns 并打印 SHA-256
node scripts/desktop/build-desktop-icon.mjs --check  # 只校验现有 icns 与品牌 SVG 是否逐档一致（不写文件）
```

脚本自动处理：Node 22 自举、corepack 直调、`ELECTRON_MIRROR` 镜像、未签名环境变量、产物断言。
退出码非 0 即失败。

产物：`.artifacts/desktop-pack-test/upstream/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/mac-arm64/AI融媒中心.app`

## 前置条件

- macOS arm64 主机（Apple Silicon）。
- 快照存在：`.artifacts/desktop-pack-test/upstream/`（gitignored，重建见指南「快照重建」）。
- 首次打包需联网（npm 产物已缓存在快照 node_modules；Electron 二进制走 npmmirror 镜像）。
- 不要求 Apple 签名凭据（`WORKDSH_DESKTOP_UNSIGNED=1` 由脚本注入）。

## 补丁存档（patches/upstream/）

`patches/upstream/` 存档 9 个补丁文件，按快照相对路径存放；
`pack-desktop.mjs` 每次运行逐文件 SHA-256 比对，不一致即报错（防漂移）。
改动流程：改快照 → `--sync-patches` → 存档随代码提交。清单与用途见指南「补丁存档」。

## 品牌图标（workdsh-icon.icns）

`patches/upstream/apps/desktop/workdsh-icon.icns` 是 9 个补丁之一，图形唯一来源是
`assets/brand/ai-rongmei-icon.svg`（由 `scripts/build-brand-assets.mjs` 产出）。**该 SVG 改动后必须重新生成 icns**，
否则应用图标与品牌脱钩——历史上这枚 icns 曾长期留在由更早旧标识资产生成、且源文件已不在仓库内的状态，无法复核。

`build-desktop-icon.mjs` 把「SVG → 10 档 iconset（16–1024px，含 @2x）→ icns」固化为可重跑路径：
每档由 SVG 独立栅格化（不做位图放大），写入后立即反解校验 10 档内容，并打印容器 SHA-256；
`--check` 不写文件，只逐档比对现有 icns 与 SVG 的渲染结果（比对的是 PNG 内容，容器级差异不影响判定）。

依赖 macOS 的 `sips` 与 `iconutil`，因此不并入跨平台的 `build-brand-assets.mjs`。
