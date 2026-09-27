# WorkDSH Desktop 外壳

[English](README.md)

本包构建 Electron 应用。安装包包含 `lib/workdsh-main.js` 和一套运行时 Profile。DeepSeek Harness 的 Host、Web Client 及核心能力来自该 Profile 中固定的上游版本。WorkDSH 的项目、资料库、专家、技能、连接器及其支撑服务由 `workdsh-bundle` 组合，不是另外几个 Desktop 版本。

## 品牌资产

应用图标与托盘图标都是**生成的，不是手工放入的二进制**：

| 产物 | 来源 | 生成器 |
| --- | --- | --- |
| `build/app-icon.png` | `workdsh-web/assets/brand/ai-rongmei-icon.svg` | `scripts/generate-brand-app-icon.mjs` |
| `build/app-icon.ico` | `build/app-icon.png` | `scripts/generate-windows-app-icon.mjs` |
| `build/app-icon-mac.png` | `build/app-icon.png` | `scripts/generate-mac-app-icon.mjs` |
| `build/tray-icon.svg` | `workdsh-web/scripts/build-brand-assets.mjs` | 由该脚本写入 |
| `build/tray-icon*.png` | `build/tray-icon.svg` | `scripts/generate-tray-icons.mjs` |

几何、色值、命名只有一个来源：`workdsh-web/scripts/build-brand-assets.mjs`，它同时产出机器可读的 `workdsh-web/assets/brand/brand.json`。上表生成器从该文件读强调色，因此本包不再硬编码品牌色。`yarn build` 按上表顺序全部重新生成。检测两个 workspace 之间的漂移用 `node workdsh-web/scripts/check-brand-consistency.mjs`；要换 logo 请改该真源脚本后重新生成，**不要手改任何 `build/*.png`**。

## 开发

使用 Node.js `^22.19.0` 或 `>=24`，以及通过 Corepack 启动的 Yarn 4.18.0。在仓库根目录执行：

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

`dev` 构建外壳、准备固定版本的 Profile 和主运行时，再启动 Electron。它是这里唯一会打开图形应用的命令。无界面验证使用 `corepack yarn check` 和 `corepack yarn check:desktop-dsh-alignment`。`corepack yarn workspace dsh-plugin-desktop package:dir` 生成未压缩应用，并检查其中没有第二套 DSH 依赖。

本包不修改上游源码。升级 DSH 时，同时更新子模块固定版本和运行时准备版本；发布前验证 WorkDSH Profile、两个平台的打包检查及最终安装包。默认选择上游最新正式版；预发布版需要明确的产品决定。

外壳源码与打包脚本在本目录。Profile 包的源码和发布属于 WorkDSH 仓库；参见[Desktop 归属约束](../docs/desktop-boundaries.md)。
