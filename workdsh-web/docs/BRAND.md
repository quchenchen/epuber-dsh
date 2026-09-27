# AI融媒中心 品牌资产

主标识为**六个环形节点围绕三个相连核心节点**的信号图形：外层 6 个节点代表多路媒资，内层 3 个节点与折线构成汇聚内核（形如向前传播的箭头），青绿到青蓝的线性渐变贯穿全图。图形无文字、透明背景，面向 Windows、Linux、macOS、Web、GitHub、文档与深色产品界面。

## 图形基准

源自用户提供的 `ai-media-symbol.svg`（96 × 96 网格）：

| 层 | 几何 | 语义 |
| --- | --- | --- |
| 外环 | 6 个 `r=5` 节点，正六边形分布（中心 `48,48`，半径 `38`） | 多路媒资 / 多源采集 |
| 内芯 | 3 个 `r=8` 节点 + 折线 `M37 34 → 61 48 → 37 62`（`stroke-width 7`，圆端圆角连接） | 汇聚流转，形如向前传播 |
| 色彩 | 线性渐变 `#13D6AA → #21A8ED`，`gradientUnits="userSpaceOnUse"` 横向铺满 96 网格 | 信号 / 智能 |

## 两个 cut（同一图形，不是两套设计）

| cut | 构成 | 使用尺寸 |
| --- | --- | --- |
| **完整版 `full`** | 外环 6 节点 + 内芯折线与 3 节点 | ≥ 48px |
| **紧凑版 `compact`** | 仅内芯，按 `1.82×` 放大并预变换坐标铺满网格（`stroke-width 12.74`） | ≤ 40px |

**为什么必须切分**（实测，见 `assets/brand/ai-rongmei-preview.html`「两种 cut 的取舍」）：完整版在 32px 时外环 6 个节点退化为约 2px 散点、内芯粘成一团；22px（产品侧栏实际尺寸）已无法辨识。紧凑版在 24 / 22px 仍是清晰的粗圆角箭头与 3 个节点，18 / 16px 仍可辨认。

阈值常量：`BRAND_COMPACT_BELOW = 48`（`packages/ui/src/components/brand-shape.ts`）。带底座时按**图形有效像素**判定 —— 先扣掉内边距，因此底座版会更早切换到紧凑 cut。

> 紧凑版的坐标在生成脚本内**预变换**，不通过 `<g transform>` 实现。原因：渐变是 `userSpaceOnUse`，若跟着缩放坐标系走，色彩扫描范围会被裁掉大半。

## 资产清单

| 文件 | 用途 |
| --- | --- |
| `assets/brand/ai-rongmei-mark.svg` | 完整版主标（信号渐变，透明底），深色背景、大尺寸、README |
| `assets/brand/ai-rongmei-mark-compact.svg` | 紧凑版主标（信号渐变，透明底），小尺寸外部投放 |
| `assets/brand/ai-rongmei-mark-mono.svg` | 完整版单色（墨色），受限印刷与灰度场景 |
| `assets/brand/ai-rongmei-mark-mono-inverse.svg` | 完整版单色（白），深底单色场景 |
| `assets/brand/ai-rongmei-icon.svg` | 应用图标（深色圆角底座 + 完整版主标，512 × 512） |
| `assets/brand/ai-rongmei-lockup-light.svg` | 横版组合，浅色背景（深底方徽 + 中文标准字 + 英文副标） |
| `assets/brand/ai-rongmei-lockup-dark.svg` | 横版组合，深色背景 |
| `assets/brand/ai-rongmei-preview.html` | 标识总览：两个 cut、尺寸对照、方徽、横版组合、单色、色板与使用规则 |
| `website/assets/mark.svg` | 官网 favicon、页头（33px）、页脚（28px）、工作台导览 wordmark（23px）、兼容性路由（22px）—— 均为小尺寸，用**紧凑版** |
| `website/assets/mark-ring.svg` | 官网 hero 深底内嵌（102px），用**完整版** |
| `assets/brand/brand.json` | **跨端真源**（机器可读）：色值、名称、资产路径。桌面 workspace 的图标生成器读它，避免第二份色值 |
| `../dsh-plugin-desktop/build/tray-icon.svg` | 桌面托盘图标源（紧凑版 + 单一品牌色）。由本脚本跨 workspace 写入 |

## 配色

| 名称 | 值 | 用途 |
| --- | --- | --- |
| 信号渐变（起） | `#13D6AA` | 青绿端，图形左侧 |
| 信号渐变（止） | `#21A8ED` | 青蓝端，图形右侧 |
| 加深渐变 | `#0FA98A → #1B84C4` | 浅底小尺寸对比不足时的同一色相加深版 |
| 深色底座 | `#0B1220` | 应用图标 / 头像底座 |
| 墨色 | `#1F2329` | 单色变体、浅底标准字 |
| 次级字 | `#6B7075` | 浅底英文副标 |
| 深底字 | `#E7E7E7` / `#A5A5A5` | 深底标准字 / 副标 |

底座比例沿用提供方的深底预览：圆角 `40/192`、内边距 `24/192`、图形占底座 `1.5/192`（常量 `BRAND_TILE_RX_RATIO` / `BRAND_TILE_INSET_RATIO` / `BRAND_TILE_GLYPH_SCALE`）。

产品界面内的主标使用**自有图形与自有色值**，不绑定宿主主题 token：官方包内不存在 `--dsw-alias-brand-primary`，绑定它只会回落到兜底值并被宿主品牌色污染。

## 使用规则

- ≥ 48px 用完整版；≤ 40px 用紧凑版。
- 正式界面优先使用 SVG；位图仅用于导出与外部投放。
- 透明底优先。需要实体块（应用图标、头像、品牌块）时用深色底座 `#0B1220`。
- 主标四周留白不小于图形高度的 1/4；不旋转、不加投影、不改变节点数量与相对位置、不改变折线走向、不拉伸。
- 不得把两个 cut 混用在同一视觉层级内（例如页头用紧凑版、紧邻的同尺寸位置用完整版）。

## 跨端单一真源（web ↔ 桌面）

`scripts/build-brand-assets.mjs` 是**全仓库唯一的品牌来源**：几何（外环节点、内芯折线与节点）、渐变、两个 cut 的预变换参数、底座比例、中英文名，全部只在该文件的常量里定义一次。它一次产出三组东西：

1. 上表全部 SVG 与 `packages/ui/src/components/brand-shape.ts`（组件 `LogoMark.tsx` 消费该 TS 模块，故 TSX 与 SVG 不会出现两份图形漂移）；
2. `assets/brand/brand.json` —— 机器可读的跨端真源；
3. `../dsh-plugin-desktop/build/tray-icon.svg` —— 桌面托盘图标源。

桌面 workspace 的图标生成器**从 `brand.json` 取色**，不再自行硬编码色值：

```
workdsh-web/scripts/build-brand-assets.mjs          ← 唯一真源（几何 + 色 + 名）
  ├─ workdsh-web/assets/brand/*.svg                 web 资产
  ├─ workdsh-web/assets/brand/brand.json            跨端真源
  ├─ workdsh-web/packages/ui/.../brand-shape.ts     组件几何
  └─ dsh-plugin-desktop/build/tray-icon.svg         托盘图标源
              ↓  yarn workspace dsh-plugin-desktop build
  dsh-plugin-desktop/build/
    app-icon.png      ← 由 ai-rongmei-icon.svg 渲染（generate-brand-app-icon.mjs）
    app-icon.ico      ← 派生自 app-icon.png（generate-windows-app-icon.mjs）
    app-icon-mac.png  ← 派生自 app-icon.png（generate-mac-app-icon.mjs）
    tray-icon*.png    ← 派生自 tray-icon.svg（generate-tray-icons.mjs）
              ↓  scripts/desktop/build-desktop-icon.mjs（sips + iconutil，仅 macOS）
  workdsh-icon.icns   ← 自建旁路链（未签名本机测试版）
```

```bash
node scripts/build-brand-assets.mjs        # 重新生成全部资产（含跨端真源与托盘源）
node scripts/check-brand-consistency.mjs   # 校验两端与真源无漂移，漂移即非 0 退出
```

### 改名的完整动作

品牌名（`NAME_ZH` / `NAME_EN` / `DESKTOP_ARTIFACT_SLUG`）与图形一样，都只在 `build-brand-assets.mjs` 顶部定义一次。改名 = 改那三个常量，然后：

```bash
node scripts/build-brand-assets.mjs        # 1. 重生成 SVG / TS / brand.json / 桌面托盘源
node scripts/sync-brand-to-desktop.mjs     # 2. 把名字同步进桌面（见下）
node scripts/check-brand-consistency.mjs   # 3. 校验两端一致
cd ../dsh-plugin-desktop && yarn build     # 4. 重生成 app-icon.png / ico / mac png / 托盘位图
```

需要 icns 时再在 macOS 上跑 `scripts/desktop/build-desktop-icon.mjs` 并同步快照。

> **为什么第 2 步不能省**：web 侧运行时可读 `brand.json`，但桌面侧有两处读不到它——`package.json` 是静态 JSON（不能执行代码），Electron 主进程代码会被打包进可执行文件。所以名字必须由同步脚本"冻"成静态值：写进 `package.json` 的品牌字段、生成 `src/brand.generated.ts`（主进程用）、生成 `build/assistedMessages.yml`（安装向导文案）。`brand.generated.ts` 因此是**生成产物，不要手改**。

**改名时「不用动」的两类 `WorkDSH`**（`brand:check` 末尾那份「清单（非失败项）」就是给这一步看的）：

1. **产物身份** —— `profiles/workdsh`、`build/workdsh-runtime`、npm 包 `workdsh-bundle`、入口 `lib/workdsh-main.js`，以及主进程里以它们为主语的句子（`Bundled WorkDSH runtime is incomplete…`、`Bundled WorkDSH launcher is missing…`、`Invalid WorkDSH browser worker arguments`、协议标记 `WORKDSH_BROWSER_WORKER_READY`、`tsdown.config.ts` 里「bundled WorkDSH Profile」）。这些是**路径、包名与协议**，改了就断链；产品改名并不要求它们改名。同理 `appId`（`io.techflag.dsh.ssh`）**刻意不动**，以保留已安装用户的升级路径。
2. **fixture** —— `dsh-plugin-desktop/tests/*.spec.ts` 里作为**构造输入**出现的 `WorkDSH`。它们不是期望值，改了会让测试与实现脱钩。

反过来，**以「运行中的应用」为主语的句子必须走真源**：`WorkDSH failed to start` → `${BRAND_DISPLAY_NAME} failed to start`、`then reopen WorkDSH` → `then reopen ${BRAND_DISPLAY_NAME}`。判断口径一句话：**这句在说路径 / 包名 / 协议 → 留；在说用户眼前这个程序 → 换成品牌名。**

**跑完 4 步仍需人工确认的地方**（`brand:check` 会报历史名残留，但不自动改写）：

- `dsh-plugin-desktop/scripts/` 与 `tests/` 里带**产物 slug** 的期望值（`verify-win-installer.ts` 的 `Setup.exe` 名、`inspect-windows-installed-app.ts` 与 `probe-windows-packaged-runtime.ts` 的 exe 名、`build-windows-nsis-ab.ts` 的安装包名）。它们的 interface 被 fixture 测试覆盖，自动改写会连带改测试，故以检查代替。
- `README*.md` / `website/` 的下载链接（URL 内嵌上游安装包名，属发行定位，不是纯文案）。

**换一次 logo 的完整动作**：改 `build-brand-assets.mjs` 常量 → 跑上面两条 → 在 `dsh-plugin-desktop` 跑一次 `build`（重生成 PNG / ICO / 托盘位图）→ 需要 icns 时在 macOS 上跑 `build-desktop-icon.mjs` 并同步快照。

> 历史教训：2026-09 之前 web 用信号环 `#13D6AA→#21A8ED`、桌面用自己的 W 形与 `#176BFF/#18CFE7`，两套视觉并存，且**没有任何检查能发现它们已经不一致**（桌面图标母版还是一张无法复现的手工二进制）。`check-brand-consistency.mjs` 就是为这类漂移设的闸。

## 落地位置

| 位置 | 实现 |
| --- | --- |
| 产品侧栏品牌位 | `sidebar.brand.mark` → `LogoMark size={22}`（自动紧凑版）；`sidebar.brand.name` → 「AI融媒中心」 |
| 诊断面板导航图标 | `LogoMark size={18}`（自动紧凑版） |
| 官网四页 | `website/assets/mark.svg`（小尺寸）/ `mark-ring.svg`（hero 102px） |
| README（中英） | `assets/brand/ai-rongmei-mark.svg` |
| 桌面应用图标（官方链 `dsh-plugin-desktop`） | `build/app-icon.png` ← `ai-rongmei-icon.svg`（`generate-brand-app-icon.mjs`）；再派生 `app-icon.ico`（Windows）与 `app-icon-mac.png`（macOS） |
| 桌面托盘图标（官方链） | `build/tray-icon.svg` → `tray-icon*.png`，与 web 同一品牌色 |
| 桌面打包图标（自建旁路链，仅本机未签名测试） | `workdsh-icon.icns`，由 `ai-rongmei-icon.svg` 经 `scripts/desktop/build-desktop-icon.mjs` 生成（sips + iconutil，10 档逐档校验；见 DESKTOP-PACKAGING） |

`LogoMark` 的渐变 id 由 `useId()` 生成并按需清洗，避免同页多实例引用到第一个实例的定义。

## 更正记录

| 时间 | 内容 |
| --- | --- |
| 2026-09-25（第一次改版） | 误把 **DeepSeek 的鲸形轮廓**（原生坐标系 `23.16 × 17.04`，与官方客户端 `dsh-client-ui-primitives` 的 `FishLogo` 同一轮廓）当作「融媒体标识」铺满全仓。该版本**已全部移除**。 |
| 2026-09-25（第二次改版） | 改出「字标 A + 青色四角星」的抽象方案。该版本**已作废**，被当前融媒体图形取代。 |
| 2026-09-25（当前版本） | 以用户提供的 `ai-media-symbol.svg` 为唯一基准，融合进全部资产层，并新增紧凑 cut 解决小尺寸糊点问题。 |
| 2026-09-27（跨端统一 · 第二轮） | 主进程里以「运行中的应用」为主语的诊断串（`failed to start` / `cannot replace` / `reopen` / `cannot update`）改用 `brand.generated.ts` 常量；修正 `check-brand-consistency.mjs` **自身**的两处缺陷——生成器色值扫描改为**先剥注释**（否则「历史色值」注释会被误判成硬编码，注释越诚实越红），`build.*` 的 `WorkDSH` 扫描改为**递归**（原先只摊平一层，漏掉第三层的 `mac.extendInfo.CFBundleDisplayName`）；新增 `src/` 残留清单输出，把「产物身份 vs 应用名」的判据变成每次可见。 |
| 2026-09-27（跨端统一） | web 与桌面各自演化出了不同图形与色值（web 信号环 `#13D6AA→#21A8ED`；桌面 W 形 + `#176BFF/#18CFE7`），桌面应用图标母版还是无法复现的手工二进制。本次把真源扩为跨端：新增 `brand.json` 与桌面托盘源产出、桌面生成器改为真源取色、新增 `generate-brand-app-icon.mjs` 让图标母版可重跑、新增 `check-brand-consistency.mjs` 检出漂移；桌面显示名与产物名统一为「AI融媒中心」/`ai-rongmei-center`（`appId` 保持不变，以保留已安装用户的升级路径）。 |

---

## 存档：WorkDSH 时期原始规范（2026-09-25 前，逐字保留）

> 以下为改版前的原文，完整保留以便追溯；所列资产仍在仓库内，但已不在产品界面使用。

WorkDSH 主标识使用向上展开的折叠式 `W`，右上角单个四角星表示智能辅助。图形保持单一轮廓和有限色彩，面向 Windows、Linux、macOS、Web、GitHub、文档和深色产品界面。

- `assets/brand/workdsh-mark.svg`：透明背景主标，适合产品内、README 与单色延展。
- `assets/brand/workdsh-logo.svg`：带圆角底座的应用图标，适合启动器与仓库头像。
- `assets/brand/workdsh-logo-concept.png`：ImageGen 生成的高分辨率视觉稿，用于评审与导出位图。

正式界面优先使用 SVG。小于 24px 时只使用主标，不附加产品文字。当前资产为 WorkDSH 自有方向，不复用 WorkBuddy、DeepSeek Harness 或其他应用的商标轮廓。
