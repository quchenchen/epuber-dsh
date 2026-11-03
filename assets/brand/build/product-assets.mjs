// 产品侧品牌资产生成器（唯一源）
// 96 网格是品牌定义坐标系（见 assets/brand/build/brand.mjs）；
// 仓库内既有资产统一使用 256 viewBox，此处按 8/3 等比换算后写出，不改变形态比例。
//
// 两档几何：
//   full    — 标准档，用于 ≥32px 的一切场景
//   compact — 光学补偿档，用于 <32px（托盘 16/20/24、小帧图标）
//             结构与 full 完全相同（六段弧 + 中心三角），只加粗弧宽、收窄间隙、放大三角，
//             补的是小尺寸下被糊掉的对比度，不是另一个标志。
//
// 运行：node assets/brand/build/product-assets.mjs

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

/* ---------- 品牌定义（96 网格，与 brand.mjs 保持一致） ---------- */
const GRID = 96
const K = 256 / GRID // 2.6667
const ANGLES = [-90, -30, 30, 90, 150, 210]

const GEOM = {
  full: { center: 48, ringRadius: 35, arcWidth: 6, span: 18, triRadius: 13.5, triCenterX: 47, triStroke: 7 },
  compact: { center: 48, ringRadius: 34, arcWidth: 7.5, span: 20, triRadius: 15, triCenterX: 46, triStroke: 8 },
}

const PRIMARY = '#0B6FE0'
const ACCENT = '#12D6B0'

const rad = (d) => (d * Math.PI) / 180
const n = (v) => Math.round(v * 100) / 100
const pt = (r, deg, cx, cy) => [n(cx + r * Math.cos(rad(deg))), n(cy + r * Math.sin(rad(deg)))]

/** 在 256 网格里构建一个标志：返回弧段合并路径、三角路径与笔画宽度。 */
function build(g) {
  const c = g.center * K
  const R = g.ringRadius * K
  const W = g.arcWidth * K
  const triR = g.triRadius * K
  const triCx = g.triCenterX * K
  const triSw = g.triStroke * K

  const arcs = ANGLES.map((a) => {
    const [x1, y1] = pt(R, a - g.span, c, c)
    const [x2, y2] = pt(R, a + g.span, c, c)
    return `M${x1} ${y1}A${n(R)} ${n(R)} 0 0 1 ${x2} ${y2}`
  }).join('')

  const t = [[n(triCx + triR), c], ...[-122, 122].map((d) => pt(triR, d, triCx, c))]
  const tri = `M${t[0][0]} ${t[0][1]}L${t[1][0]} ${t[1][1]}L${t[2][0]} ${t[2][1]}Z`

  return { c, R, arcs, tri, arcWidth: n(W), triStroke: n(triSw) }
}

const FULL = build(GEOM.full)
const COMPACT = build(GEOM.compact)

const body = (m) => `<g>
  <path d="${m.arcs}" fill="none" stroke="${PRIMARY}" stroke-width="${m.arcWidth}" stroke-linecap="round"/>
  <path d="${m.tri}" fill="${PRIMARY}" stroke="${PRIMARY}" stroke-width="${m.triStroke}" stroke-linejoin="round"/>
</g>`

const ALT = 'aria-labelledby="title desc"'

/* ---------- 裸标志（256） ---------- */
const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" ${ALT}>
  <title id="title">AI 融媒中心 mark</title>
  <desc id="desc">Six arc segments forming a broken ring around a solid triangle: six sources feeding one broadcast outlet.</desc>
${body(FULL)}
</svg>
`

/* ---------- 圆角底板版（320 画布） ----------
   标志视觉外接 = 2 × (R + 弧宽/2)，缩放到 200 宽后居中于 320 画布。 */
const visual = 2 * (FULL.R + FULL.arcWidth / 2)
const s = 200 / visual
const t = n(160 - FULL.c * s)

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" ${ALT}>
  <title id="title">AI 融媒中心</title>
  <desc id="desc">The six-source broadcast mark on a neutral rounded tile.</desc>
  <rect x="12" y="12" width="296" height="296" rx="68" fill="#F7F8FA" stroke="#E1E4EA" stroke-width="4"/>
  <g transform="translate(${t} ${t}) scale(${n(s)})">
${body(FULL)}
  </g>
</svg>
`

/* ---------- 托盘图标（16–32px 原生尺寸，用紧凑档） ---------- */
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 256 256" fill="none">
${body(COMPACT)}
</svg>
`

/* ---------- 小尺寸裸标志（<32px 的界面位置，用紧凑档） ---------- */
const markSmSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" ${ALT}>
  <title id="title">AI 融媒中心 mark</title>
  <desc id="desc">Compact optical variant of the six-source mark for sizes below 32px.</desc>
${body(COMPACT)}
</svg>
`

const targets = [
  ['apps/web/assets/brand/epuberdsh-mark.svg', markSvg],
  ['apps/web/assets/brand/epuberdsh-mark-sm.svg', markSmSvg],
  ['apps/web/assets/brand/epuberdsh-logo.svg', logoSvg],
  ['apps/web/website/assets/mark.svg', markSvg],
  ['apps/web/website/assets/mark-sm.svg', markSmSvg],
  ['apps/web/website/assets/logo.svg', logoSvg],
  ['apps/desktop/build/tray-icon.svg', traySvg],
]

for (const [rel, content] of targets) writeFileSync(resolve(REPO, rel), content)

console.log(
  JSON.stringify(
    {
      k: n(K),
      full: { R: n(FULL.R), arcWidth: FULL.arcWidth, triStroke: FULL.triStroke },
      compact: { R: n(COMPACT.R), arcWidth: COMPACT.arcWidth, triStroke: COMPACT.triStroke },
      tileScale: n(s),
      tileTranslate: t,
      primary: PRIMARY,
      accent: ACCENT,
    },
    null,
    2,
  ),
)
console.log(`wrote ${targets.length} files`)
