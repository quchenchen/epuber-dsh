# workdsh-plugin-weknora-theme

把 WorkDSH 的配色与圆角换成 WeKnora 的视觉语言（中性灰 + 绿色品牌）。表现层插件：Host 侧不提供服务、不落库、不读文件，浏览器侧只往官方主题运行时**叠一层别名 token 覆盖**。

## 生效机制

用的是官方 `@deepseek-ai/dsh-client-ui-theme` 的公开接缝 `ctx.theme.overrideTokens(source, tokens)`：

- **只叠覆盖层**，不改主题注册表、不 `setTheme`、不订阅 `theme/change`、不否决。
  这条红线来自本仓的教训：`packages/bundle/CHANGELOG.md` 记过 workbench 客户端曾自注册 `workdsh` 深色主题并否决 `theme/change`，把调色板 pin 住、令外观开关失效；那段已移除（"外观改由官方 ThemeRuntime 与用户偏好驱动"）。叠层不可能复现那个故障——覆盖层只对「当前生效主题」逐 token 生效，用户一改外观就随之换档。
- 覆盖层按 `source` 标识，**同 source 重注册=整层替换**；卸载即该层消失。
- 叠加顺序由运行时维护（后叠的逐 token 胜出），本插件全量声明自己那 42 个 token，不依赖与他人的先后关系。

## 覆盖范围

42 个 token，分 4 组，**只碰 `--dsw-alias-*` / `--dsw-specific-*` / `--dsw-radius-*`**：

| 组 | 条数 | 干什么 |
|---|---|---|
| `core` | 14 | 与官方 `exportInspectTokens()` 发布的目录一一对应（底色/描边/品牌/文字/状态/侧栏） |
| `brandCoherence` | 8 | 品牌一致性：链接、主按钮 hover、品牌文字、业务态强调色 |
| `neutralTemperature` | 16 | 中性色温：把 dsh 的偏蓝中性换成 WeKnora 的纯灰，hover/选中改为中性叠加而非品牌洗色 |
| `cornerScale` | 6 | 圆角：4/6/8/10/12 对应 WeKnora `--app-radius-*`，`panel` 夹到上限 |

**取值来源可审计**：每一行都注明取自 WeKnora 的哪个 token，源头是
`WeKnora/frontend/src/assets/theme/theme.css`（`--td-brand-color-1..10`、
`--td-gray-color-1..14`、`--td-bg-color-*`、`--td-text-color-*`、`--app-radius-*`）。
浅/深两档都按 WeKnora 自己的 ramp 重排（WeKnora 深色块重声明了品牌梯级，
所以浅色取 `-4` 而深色取 `-5`——写错就会出现「浅色档太淡/深色档看不清」）。

**刻意不覆盖**：

- `--dsw-focus-ring-color`：基础样式在 `html[data-input-modality=pointer]` 下声明为
  `transparent`（点按不出环）。内联 body 值会盖过那条规则、破坏 modality 契约。
  焦点环改由 `--dsw-alias-state-business-primary` 跟随品牌色。
- `--dsw-font-family`：dsh 本就是含 PingFang SC 的系统字体栈，与 WeKnora 同族；
  重指只增加风险、不改观感。
- `--dsw-static-*`：官方调色板的原子层，不是第三方覆盖目标。

边界：**只改配色与圆角**，不动布局、间距、字重、交互与信息层级。圆角只会变小，不会让任何表面开始裁切内容。

## 构建 / 安装 / 验证

```sh
# 构建（tsc 产出宿主半 + esbuild 产出浏览器半）
corepack pnpm --filter workdsh-plugin-weknora-theme build

# 安装（打成 tgz 后走官方命令，再重启该 Profile）
dsh plugin --profile <profile> add <packed.tgz>

# 浏览器探针（需 Host 已在 18989 上跑；默认环境 .test-runtime/preview）
node .test-runtime/probe-weknora-skin.mjs "http://127.0.0.1:18989/?token=..."
node .test-runtime/probe-weknora-skin.mjs "<login url>" --restore=dark
```

探针验四件事：42 个 token 是否都以内联自定义属性落到 `body`、浅/深两档是否解析成 WeKnora 的实际色值、两套底色是否确实不同（证明没被 pin 住）、以及官方外观控件是否仍可用。
它会改「外观」偏好（App 点击后的正常行为），并在结束时恢复——以 profile 的 `cordis.patch.yml` 文件内容确认恢复成功。

小提示：本仓构建脚本用 esbuild 默认的相对路径注释，源码路径取决于执行时的 CWD，
所以「从仓库根跑」与「pnpm 在包目录里跑」产出的 `client.browser.js` 哈希不同（仅注释差异）。
这与本仓另几个插件的行为一致，不是本插件特有。

## 卸载

移除包即移除覆盖层，官方配色立刻回来；**不写任何偏好**，无需清理用户设置。
