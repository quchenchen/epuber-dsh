#!/usr/bin/env node
/**
 * 「AI融媒中心」品牌图形**单一源**。
 *
 * 一次产出全部 SVG 资产 + packages/ui/src/components/brand-shape.ts，
 * 组件 LogoMark.tsx 消费该 TS 模块，因此 TSX 与 SVG 不会出现两份图形漂移。
 *
 * 图形基准（用户提供的 `ai-media-symbol.svg`）：
 *   外层 6 个节点（r=5，正六边形分布，半径 38）—— 多路媒资；
 *   内层 3 个节点（r=8）+ 折线（圆端 stroke 7）—— 汇聚流转，形如向前传播的箭头；
 *   线性渐变 #13D6AA → #21A8ED（青绿 → 青蓝）横向铺满 96 网格。
 *
 * 两个 cut（同一图形，不是两套设计）：
 *   full    —— 完整版，用于 ≥48px（hero、README、应用图标、品牌规范页）。
 *   compact —— 紧凑版，取內芯「3 节点 + 折线」按 1.82 倍放大铺满网格，去掉外环。
 *              用于 ≤40px：实测 32px 以下外环 6 个节点退化为约 2px 散点、
 *              内芯粘成一团，故小尺寸只保留最具辨识度的内核。
 *
 * 这是**全仓库的品牌单一真源**（web 与桌面共用）：几何、色值、中英文名
 * 都只在本文件里定义一次。除本 workspace 的 SVG / TS 外，本脚本还产出
 * 桌面 workspace（`dsh-plugin-desktop/`）消费的两个文件：
 *   - `assets/brand/brand.json`              机器可读真源，桌面图标生成器读它
 *   - `../dsh-plugin-desktop/build/tray-icon.svg`  托盘图标源（品牌图形 + 品牌色）
 * 因此「改 logo」= 改本文件常量 → 跑一次本脚本 → 两端产物同步；
 * 不再需要在桌面侧单独手改图形或色值（历史上正是这样漂移出鲸形 vs 信号环两套视觉）。
 *
 * 用法：node scripts/build-brand-assets.mjs
 *
 * 合规：图形来自用户提供的自有标识；未使用 WorkBuddy、DeepSeek Harness
 *       或其他应用的商标轮廓。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * 图形参数
 * ------------------------------------------------------------------ */

const GRID = 96;

/** 信号渐变（原始，深底/大尺寸）。 */
const GRAD = { from: '#13D6AA', to: '#21A8ED' };
/** 同色相加深版，浅底小尺寸对比不足时使用。 */
const GRAD_DEEP = { from: '#0FA98A', to: '#1B84C4' };

const INK = '#1F2329';
const WHITE = '#FFFFFF';
/** 深色底座（取自用户提供的深底预览）。 */
const TILE_DARK = '#0B1220';
const TILE_LIGHT = '#F7F8FA';
const TILE_LINE = '#E1E4EA';
const TEXT_SUB = '#6B7075';
const TEXT_SUB_DARK = '#A5A5A5';

/** 深色底座圆角比例与内边距比例（沿用用户深底预览：192 → rx 40 / inset 24）。 */
const TILE_RX_RATIO = 40 / 192;
const TILE_INSET_RATIO = 24 / 192;
const TILE_GLYPH_SCALE = 1.5 / 192;

/** 外环节点：正六边形，中心 (48,48)，半径 38，r=5。 */
const OUTER_NODES = [
  [48, 10],
  [78, 29],
  [78, 67],
  [48, 86],
  [18, 67],
  [18, 29],
].map(([cx, cy]) => ({ cx, cy, r: 5 }));

/** 内芯折线：3 节点两段相连（圆端），形如向前传播的箭头。 */
const CORE_PATH = 'M37 34 61 48 37 62';
const CORE_STROKE = 7;
const CORE_NODES = [
  [37, 34],
  [61, 48],
  [37, 62],
].map(([cx, cy]) => ({ cx, cy, r: 8 }));

/**
 * 紧凑版缩放：内芯几何包围盒 y 26..70（高 44）放大到 80，即 k = 1.82。
 * 以包围盒中心 (49,48) 映射到网格中心 (48,48)，保持光学居中。
 * 这里**预变换坐标**而不是给 `<g>` 加 transform —— 否则
 * userSpaceOnUse 渐变会跟着缩放坐标系走，color sweep 被裁掉大半。
 */
const COMPACT_K = 1.82;
const applyCompact = ({ cx, cy, r }) => ({
  cx: +(48 + (cx - 49) * COMPACT_K).toFixed(2),
  cy: +(48 + (cy - 48) * COMPACT_K).toFixed(2),
  r: +(r * COMPACT_K).toFixed(2),
});
const COMPACT_CORE_NODES = CORE_NODES.map(applyCompact);
const COMPACT_CORE_STROKE = +(CORE_STROKE * COMPACT_K).toFixed(2);
const COMPACT_CORE_PATH = CORE_PATH.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_m, a, b) => {
  const p = applyCompact({ cx: +a, cy: +b, r: 0 });
  return `${p.cx} ${p.cy}`;
});

/** 小于该尺寸改用紧凑版。 */
const COMPACT_BELOW = 48;

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

const gid = (n) => `aimc-signal-${n}`;

const gradientDef = (paint, id) =>
  `  <defs>\n    <linearGradient id="${id}" x1="0" y1="0" x2="${GRID}" y2="0" gradientUnits="userSpaceOnUse">\n      <stop offset="0" stop-color="${paint.from}"/>\n      <stop offset="1" stop-color="${paint.to}"/>\n    </linearGradient>\n  </defs>`;

/** 图形内容。paint 为 `url(#id)` 或具体色值。 */
function content(cut, paint) {
  const nodes = cut === 'compact' ? COMPACT_CORE_NODES : CORE_NODES;
  const d = cut === 'compact' ? COMPACT_CORE_PATH : CORE_PATH;
  const sw = cut === 'compact' ? COMPACT_CORE_STROKE : CORE_STROKE;
  const out = [];
  if (cut === 'full') {
    for (const n of OUTER_NODES) out.push(`    <circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="${paint}"/>`);
  }
  out.push(
    `    <path d="${d}" fill="none" stroke="${paint}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  for (const n of nodes) out.push(`    <circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="${paint}"/>`);
  return out.join('\n');
}

/** 裸标（透明底）。paint 为 null 时用渐变。 */
function bareSvg({ cut = 'full', paint = GRAD, mono = null, id = 'm', size = null, title = 'AI融媒中心' }) {
  const ref = mono ?? `url(#${gid(id)})`;
  const head = mono ? '' : `${gradientDef(paint, gid(id))}\n`;
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}"${dim} role="img" aria-label="${title}">
${head}  <g>
${content(cut, ref)}
  </g>
</svg>
`;
}

/** 深色方徽（应用图标 / 头像 / 横版组合底座）。 */
function tileSvg({ size = 512, cut = 'full', id = 't', title = 'AI融媒中心', rx = null, inset = null } = {}) {
  const R = rx ?? +(size * TILE_RX_RATIO).toFixed(2);
  const P = inset ?? +(size * TILE_INSET_RATIO).toFixed(2);
  const scale = +(size * TILE_GLYPH_SCALE).toFixed(4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${title}">
${gradientDef(GRAD, gid(id))}  <rect width="${size}" height="${size}" rx="${R}" fill="${TILE_DARK}"/>
  <g transform="translate(${P} ${P}) scale(${scale})">
${content(cut, `url(#${gid(id)})`)}
  </g>
</svg>
`;
}

/** 横版组合：深色方徽 + 中文标准字 + 英文副标。 */
function lockupSvg({ textFill, subFill, id }) {
  const box = 68;
  const P = +(box * TILE_INSET_RATIO).toFixed(2);
  const scale = +(box * TILE_GLYPH_SCALE).toFixed(4);
  const rx = +(box * TILE_RX_RATIO).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96" width="420" height="96" role="img" aria-label="AI融媒中心">
${gradientDef(GRAD, gid(id))}  <rect x="12" y="14" width="${box}" height="${box}" rx="${rx}" fill="${TILE_DARK}"/>
  <g transform="translate(${12 + P} ${14 + P}) scale(${scale})">
${content('full', `url(#${gid(id)})`)}
  </g>
  <text x="98" y="50" font-family="'PingFang SC','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif" font-size="31" font-weight="600" fill="${textFill}" letter-spacing="0.5">AI融媒中心</text>
  <text x="99" y="72" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="500" fill="${subFill}" letter-spacing="1.6">AI CONVERGENCE MEDIA CENTER</text>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * TS 模块（供 LogoMark.tsx 消费）
 * ------------------------------------------------------------------ */

const nodeLiteral = (nodes) =>
  nodes.map((n) => `  { cx: ${n.cx}, cy: ${n.cy}, r: ${n.r} },`).join('\n');

function tsModule() {
  return `// AUTO-GENERATED by scripts/build-brand-assets.mjs — 请勿手改；改图形请改脚本后重新生成。
//
// 图形基准：用户提供的 ai-media-symbol.svg
//   外层 6 节点（多路媒资）+ 内层 3 节点与折线构成的汇聚内核 + 青绿→青蓝信号渐变。

/** 主标网格边长。 */
export const BRAND_VIEWBOX = ${GRID};

/** 小于该像素尺寸时改用紧凑版（去掉外环、放大内核）。 */
export const BRAND_COMPACT_BELOW = ${COMPACT_BELOW};

/** 信号渐变（原始）：青绿 → 青蓝。 */
export const BRAND_GRADIENT = { from: '${GRAD.from}', to: '${GRAD.to}' } as const;

/** 信号渐变加深版：浅底小尺寸对比不足时使用。 */
export const BRAND_GRADIENT_DEEP = { from: '${GRAD_DEEP.from}', to: '${GRAD_DEEP.to}' } as const;

/** 深色底座（应用图标 / 头像）。 */
export const BRAND_TILE_COLOR = '${TILE_DARK}';

/** 深色底座圆角与内边距比例（沿用提供方的深底预览比例）。 */
export const BRAND_TILE_RX_RATIO = ${TILE_RX_RATIO};
export const BRAND_TILE_INSET_RATIO = ${TILE_INSET_RATIO};
export const BRAND_TILE_GLYPH_SCALE = ${TILE_GLYPH_SCALE};

export type BrandNode = { readonly cx: number; readonly cy: number; readonly r: number };
export type BrandCut = 'full' | 'compact';

/** 完整版：外环 6 节点。 */
export const BRAND_OUTER_NODES: readonly BrandNode[] = [
${nodeLiteral(OUTER_NODES)}
];

/** 完整版：内芯折线与 3 节点。 */
export const BRAND_CORE_PATH = '${CORE_PATH}';
export const BRAND_CORE_STROKE = ${CORE_STROKE};
export const BRAND_CORE_NODES: readonly BrandNode[] = [
${nodeLiteral(CORE_NODES)}
];

/** 紧凑版：内核放大 ${COMPACT_K} 倍（坐标已预变换，勿再套 transform，否则渐变被裁）。 */
export const BRAND_COMPACT_CORE_PATH = '${COMPACT_CORE_PATH}';
export const BRAND_COMPACT_CORE_STROKE = ${COMPACT_CORE_STROKE};
export const BRAND_COMPACT_CORE_NODES: readonly BrandNode[] = [
${nodeLiteral(COMPACT_CORE_NODES)}
];
`;
}

/* ------------------------------------------------------------------ *
 * 预览页
 * ------------------------------------------------------------------ */

const inlineBare = (n, cut, size, { paint = GRAD, mono = null } = {}) =>
  bareSvg({ cut, paint, mono, id: `p${n}`, size, title: '' }).replace(/ role="img" aria-label=""/, ' aria-hidden="true"');

const inlineTile = (n, cut, size, opts = {}) =>
  tileSvg({ size: 96, cut, id: `t${n}`, title: '', ...opts }).replace(/ role="img" aria-label=""/, ' aria-hidden="true"');

function previewHtml() {
  const small = [40, 33, 28, 24, 22, 16];
  const large = [160, 128, 96, 64, 48];
  const cell = (svg, label) => `    <div class="tileBox">${svg}<span>${label}</span></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>AI融媒中心 · 品牌标识</title>
<style>
  :root { --g1:${GRAD.from}; --g2:${GRAD.to}; --tile:${TILE_DARK}; --ink:${INK}; --line:#E3E6EC; --soft:#F6F7F9; }
  * { box-sizing:border-box; }
  body { margin:0; padding:48px 44px 64px; background:#fff; color:var(--ink);
    font:15px/1.7 "PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif; }
  h1 { font-size:26px; margin:0 0 6px; }
  h2 { font-size:15px; margin:44px 0 16px; padding-bottom:8px; border-bottom:1px solid var(--line);
    letter-spacing:1px; color:#4A4F57; font-weight:600; }
  .lede { color:#6B7075; margin:0; max-width:760px; }
  .row { display:flex; flex-wrap:wrap; gap:28px; align-items:flex-end; }
  .tileBox { text-align:center; }
  .tileBox span { display:block; margin-top:8px; font-size:11px; color:#8A8F98; }
  .dark { background:${TILE_DARK}; border-radius:16px; padding:24px 28px; display:flex; gap:30px; align-items:center; }
  .dark .tileBox span { color:#8A9199; }
  .light { background:#fff; border:1px solid var(--line); border-radius:16px; padding:24px 28px; display:inline-flex; gap:30px; align-items:center; }
  .split { display:flex; gap:18px; flex-wrap:wrap; }
  .card { border:1px solid var(--line); border-radius:14px; padding:18px 20px; flex:1 1 300px; }
  .card h3 { margin:0 0 4px; font-size:14px; }
  .card p { margin:0 0 12px; font-size:12.5px; color:#6B7075; }
  table { border-collapse:collapse; width:100%; font-size:13.5px; }
  th,td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; color:#4A4F57; background:var(--soft); }
  code { font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--soft); padding:1px 6px; border-radius:5px; }
  .rules { padding-left:20px; margin:0; }
  .rules li { margin:6px 0; }
  .swatches { display:flex; gap:14px; flex-wrap:wrap; }
  .sw { width:150px; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .sw i { display:block; height:62px; }
  .sw span { display:block; padding:8px 10px; font-size:11.5px; color:#6B7075; }
  .sw b { display:block; color:var(--ink); font-size:12.5px; }
  .note { margin-top:14px; padding:14px 16px; border-left:3px solid #E8A33D; background:#FFF9EE;
    border-radius:0 10px 10px 0; font-size:13.5px; color:#5A4B2C; }
</style>
</head>
<body>
  <h1>AI融媒中心 · 品牌标识</h1>
  <p class="lede">外层 6 节点代表多路媒资，内层 3 节点与折线构成汇聚内核，青绿到青蓝的信号渐变贯穿全图。
  同一图形提供两个 cut：<b>完整版</b>用于 48px 以上，<b>紧凑版</b>（放大内核、去掉外环）用于 40px 以下。</p>

  <h2>完整版（≥48px）</h2>
  <div class="row">
${cell(inlineBare('a1', 'full', 160), '160px')}
${cell(inlineBare('a2', 'full', 96), '96px')}
${cell(inlineBare('a3', 'full', 64), '64px')}
${cell(inlineBare('a4', 'full', 48), '48px')}
    <div class="tileBox" style="background:${TILE_DARK};padding:16px 20px;border-radius:14px">${inlineBare('a5', 'full', 96)}<span style="color:#8A9199">深底</span></div>
  </div>

  <h2>紧凑版（≤40px，界面实际尺寸）</h2>
  <div class="row" style="align-items:flex-end">
${small.map((s, i) => cell(inlineBare(`b${i}`, 'compact', s), `${s}px`)).join('\n')}
  </div>
  <div class="row" style="align-items:flex-start;margin-top:22px">
    <div class="tileBox light" style="padding:20px 24px">${inlineBare('c1', 'compact', 22)}<span>浅底侧栏</span></div>
    <div class="dark">${inlineBare('c2', 'compact', 22)}${inlineBare('c2b', 'compact', 18)}<span style="color:#8A9199;font-size:11px">深底 / 导航图标</span></div>
  </div>

  <h2>两种 cut 的取舍</h2>
  <div class="row">
    <div class="tileBox"><div style="padding:12px;background:var(--soft);border-radius:12px">${inlineBare('d1', 'full', 32)}</div><span>完整版 @32px — 外环退化为散点</span></div>
    <div class="tileBox"><div style="padding:12px;background:var(--soft);border-radius:12px">${inlineBare('d2', 'compact', 32)}</div><span>紧凑版 @32px — 轮廓清晰</span></div>
  </div>

  <h2>应用图标与方徽</h2>
  <div class="row">
${cell(inlineTile('e1', 'full', 96), '方徽 96')}
${cell(inlineTile('e2', 'compact', 64), '紧凑方徽 64')}
${cell(inlineTile('e3', 'compact', 40), '紧凑方徽 40')}
${cell(inlineTile('e4', 'compact', 24, { rx: 6, inset: 3 }), '紧凑方徽 24')}
  </div>

  <h2>横版组合</h2>
  <div class="light" style="flex-direction:column;align-items:flex-start;gap:14px">
    <div style="width:420px">${lockupSvg({ textFill: INK, subFill: TEXT_SUB, id: 'l1' }).replace(/^<svg[^>]*>/, '<svg viewBox="0 0 420 96" width="420" height="96">')}</div>
  </div>
  <div class="dark" style="margin-top:16px;flex-direction:column;align-items:flex-start;gap:14px">
    <div style="width:420px">${lockupSvg({ textFill: '#E7E7E7', subFill: TEXT_SUB_DARK, id: 'l2' }).replace(/^<svg[^>]*>/, '<svg viewBox="0 0 420 96" width="420" height="96">')}</div>
  </div>

  <h2>单色变体</h2>
  <div class="row">
    <div class="tileBox">${inlineBare('f1', 'full', 96, { mono: INK })}<span>完整版 · 墨色</span></div>
    <div class="tileBox" style="background:${TILE_DARK};padding:14px 18px;border-radius:12px">${inlineBare('f2', 'full', 96, { mono: WHITE })}<span style="color:#8A9199">完整版 · 反白</span></div>
    <div class="tileBox">${inlineBare('f3', 'compact', 48, { mono: INK })}<span>紧凑版 · 墨色</span></div>
    <div class="tileBox">${inlineBare('f4', 'compact', 48, { paint: GRAD_DEEP })}<span>紧凑版 · 加深渐变</span></div>
  </div>

  <h2>配色</h2>
  <div class="swatches">
    <div class="sw"><i style="background:linear-gradient(90deg,${GRAD.from},${GRAD.to})"></i><span><b>信号渐变</b>${GRAD.from} → ${GRAD.to}</span></div>
    <div class="sw"><i style="background:linear-gradient(90deg,${GRAD_DEEP.from},${GRAD_DEEP.to})"></i><span><b>渐变加深版</b>${GRAD_DEEP.from} → ${GRAD_DEEP.to}</span></div>
    <div class="sw"><i style="background:${TILE_DARK}"></i><span><b>深色底座</b>${TILE_DARK}</span></div>
    <div class="sw"><i style="background:${INK}"></i><span><b>墨色</b>${INK}</span></div>
  </div>

  <h2>使用规则</h2>
  <ul class="rules">
    <li>≥48px 用完整版；≤40px 用紧凑版。切换阈值见 <code>BRAND_COMPACT_BELOW</code>。</li>
    <li>界面优先 SVG；位图只用于导出与外部投放。</li>
    <li>透明底优先。需要实体块（应用图标、头像）时用深色底座 <code>${TILE_DARK}</code>，圆角与内边距按 <code>TILE_RX_RATIO</code> / <code>TILE_INSET_RATIO</code>。</li>
    <li>浅底小尺寸若对比不足，用加深渐变；不得改变节点数量、相对位置与折线走向。</li>
    <li>四周留白不小于图形高度的 1/4；不旋转、不加投影、不拉伸。</li>
  </ul>

  <div class="note"><b>图形来源：</b>本图形为「AI融媒中心」自有标识，取自用户提供的 <code>ai-media-symbol.svg</code>；
  未引用 WorkBuddy、DeepSeek Harness 或其他应用的商标轮廓。</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * 跨端真源出口（桌面 workspace 消费）
 * ------------------------------------------------------------------ */

/** 品牌中文名（用户可见的展示名）。改名只改这里。 */
const NAME_ZH = 'AI融媒中心';
/** 品牌英文名（对外/副标）。 */
const NAME_EN = 'AI Convergence Media Center';
/**
 * 桌面发行文件名用的 ASCII 标识。安装包名走这个而不是中文，
 * 避免中文文件名在 electron-builder / NSIS / DMG 各环节的不确定性。
 */
const DESKTOP_ARTIFACT_SLUG = 'ai-rongmei-center';

/**
 * 机器可读的品牌真源，供桌面 workspace 的图标生成器消费。
 * 存在的意义是**消除第二份色值**：桌面不再硬编码 #176BFF/#18CFE7。
 */
function brandJson() {
  return `${JSON.stringify({
    $comment: 'AUTO-GENERATED by workdsh-web/scripts/build-brand-assets.mjs — 请勿手改。改品牌请改该脚本常量后重新生成。',
    version: 1,
    displayName: { zh: NAME_ZH, en: NAME_EN },
    colors: {
      signalFrom: GRAD.from,
      signalTo: GRAD.to,
      signalDeepFrom: GRAD_DEEP.from,
      signalDeepTo: GRAD_DEEP.to,
      tile: TILE_DARK,
      ink: INK,
    },
    glyph: {
      grid: GRID,
      compactBelow: COMPACT_BELOW,
    },
    assets: {
      iconMaster: 'assets/brand/ai-rongmei-icon.svg',
      markFull: 'assets/brand/ai-rongmei-mark.svg',
      markCompact: 'assets/brand/ai-rongmei-mark-compact.svg',
      markMono: 'assets/brand/ai-rongmei-mark-mono.svg',
      markMonoInverse: 'assets/brand/ai-rongmei-mark-mono-inverse.svg',
      lockupLight: 'assets/brand/ai-rongmei-lockup-light.svg',
      lockupDark: 'assets/brand/ai-rongmei-lockup-dark.svg',
    },
    desktop: {
      productName: NAME_ZH,
      artifactSlug: DESKTOP_ARTIFACT_SLUG,
      traySource: 'build/tray-icon.svg',
      trayAccent: GRAD.to,
      appIconSource: 'build/app-icon.png',
      appIconCanvas: 1024,
    },
  }, null, 2)}\n`;
}

/**
 * 桌面托盘图标源。
 *
 * 取**紧凑版内核**（3 节点 + 折线）而非完整外环：托盘实际显示尺寸只有 16–32px，
 * 外环 6 节点在这个尺度会退化成散点。
 *
 * 只使用**单一品牌色**（GRAD.to）而不是渐变——桌面侧生成器要把它
 * `replaceAll` 成纯黑（macOS template image 规范）或品牌色，
 * 单色让替换是无歧义的。
 *
 * 渲染尺寸给到 256px 而不是 96px：托盘各档（16/20/24/32）由它下采样，
 * 源分辨率越高，下采样越干净。
 */
function traySvg() {
  return bareSvg({ cut: 'compact', mono: GRAD.to, id: 'tray', size: 256, title: NAME_ZH });
}

/* ------------------------------------------------------------------ *
 * 产出
 * ------------------------------------------------------------------ */

const outputs = [
  // 完整版（≥48px）：透明底 + 信号渐变
  ['assets/brand/ai-rongmei-mark.svg', bareSvg({ cut: 'full', id: 'mark', title: 'AI融媒中心' })],
  // 紧凑版（≤40px）
  ['assets/brand/ai-rongmei-mark-compact.svg', bareSvg({ cut: 'compact', id: 'mark-c', title: 'AI融媒中心' })],
  // 单色
  ['assets/brand/ai-rongmei-mark-mono.svg', bareSvg({ cut: 'full', id: 'm-mono', mono: INK, title: 'AI融媒中心' })],
  ['assets/brand/ai-rongmei-mark-mono-inverse.svg', bareSvg({ cut: 'full', id: 'm-mono-i', mono: WHITE, title: 'AI融媒中心' })],
  // 应用图标与横版组合
  ['assets/brand/ai-rongmei-icon.svg', tileSvg({ size: 512, cut: 'full', id: 'icon' })],
  [
    'assets/brand/ai-rongmei-lockup-light.svg',
    lockupSvg({ textFill: INK, subFill: TEXT_SUB, id: 'lk-l' }),
  ],
  [
    'assets/brand/ai-rongmei-lockup-dark.svg',
    lockupSvg({ textFill: '#E7E7E7', subFill: TEXT_SUB_DARK, id: 'lk-d' }),
  ],
  ['assets/brand/ai-rongmei-preview.html', previewHtml()],
  // 官网：站点为深底，小尺寸位（favicon / 页头 33 / 页脚 28 / wordmark 23 / compat 22）用紧凑版
  ['website/assets/mark.svg', bareSvg({ cut: 'compact', id: 'site', title: 'AI融媒中心' })],
  // 官网 hero 深底内嵌 102px，用完整版
  ['website/assets/mark-ring.svg', bareSvg({ cut: 'full', id: 'site-ring', title: 'AI融媒中心' })],
  // 组件共用几何
  ['packages/ui/src/components/brand-shape.ts', tsModule()],
  // 跨端真源：桌面 workspace（dsh-plugin-desktop）的图标生成器读它，从此不必各自维护色值
  ['assets/brand/brand.json', brandJson()],
  // 桌面托盘图标源。路径跨到桌面 workspace，是有意的：桌面图标必须由同一真源派生，
  // 否则又会回到「web 一套图形、桌面另一套」的漂移。
  ['../dsh-plugin-desktop/build/tray-icon.svg', traySvg()],
];

/** 上一版（字标 A / 鲸形）遗留资产，本次一并清除。 */
const STALE = [
  'assets/brand/ai-rongmei-mark-inverse.svg',
  'assets/brand/ai-rongmei-mark-ring.svg',
  'assets/brand/ai-rongmei-lockup-light-whale.svg',
];

for (const rel of STALE) {
  const abs = resolve(ROOT, rel);
  try {
    rmSync(abs);
    console.log(`✗ 已移除 ${rel}`);
  } catch {
    /* 不存在即忽略 */
  }
}

for (const [rel, body] of outputs) {
  const abs = resolve(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  console.log(`✓ ${rel}  (${body.length} B)`);
}

console.log(`
图形：外环 6 节点 + 内芯 3 节点与折线 + 信号渐变 ${GRAD.from} → ${GRAD.to}
切分：完整版 ≥${COMPACT_BELOW}px；紧凑版 <${COMPACT_BELOW}px（内核放大 ${COMPACT_K}×，折线 stroke ${COMPACT_CORE_STROKE}）
`);
