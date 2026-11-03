// AI融媒中心 · 标志候选 v2 —— 外环两种做法对比
// 语义：六个内容源/分发渠道 + 中心定向播发。
// 修掉的病：① 半径统一 ② 单色无渐变 ③ 只有一套几何，任何尺寸都是同一个标志

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..')

const C = 48
const RING_R = 34
const DOT = 6
const BLUE = '#0B6FE0'

const rad = (d) => (d * Math.PI) / 180
const n = (v) => Math.round(v * 100) / 100
const pt = (r, deg) => [n(C + r * Math.cos(rad(deg))), n(C + r * Math.sin(rad(deg)))]

const ANGLES = [-90, -30, 30, 90, 150, 210]

// 中心：实心三角，外接 15.5 + 7 笔宽圆角 ⇒ 视觉外接 ≈19
const TRI = (() => {
  const t = [[C + 15.5, C], ...[-120, 120].map((d) => pt(15.5, d))]
  return `M${t[0][0]} ${t[0][1]}L${t[1][0]} ${t[1][1]}L${t[2][0]} ${t[2][1]}Z`
})()
const tri = (c) => `<path d="${TRI}" fill="${c}" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>`

// 外环 A1：六个实心圆点
const dotsRing = (c) =>
  ANGLES.map((a) => {
    const [x, y] = pt(RING_R, a)
    return `<circle cx="${x}" cy="${y}" r="${DOT}" fill="${c}"/>`
  }).join('')

// 外环 A2：六段短弧（每段跨 40°，间隙 20°）。小尺寸下自然合并成整环。
const arcRing = (c, r = RING_R, span = 20, w = 6) =>
  ANGLES.map((a) => {
    const [x1, y1] = pt(r, a - span)
    const [x2, y2] = pt(r, a + span)
    return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`
  }).join('')

const markA1 = (c) => `<g>${dotsRing(c)}${tri(c)}</g>`
const markA2 = (c) => `<g>${arcRing(c)}${tri(c)}</g>`

// 小尺寸降级：同一轮廓，弧缩小间隙让六段靠近
const markA2Sm = (c) => `<g>${arcRing(c, RING_R, 23, 6.6)}${tri(c)}</g>`
const markA1Sm = (c) => `<g>${dotsRing(c)}${tri(c)}</g>`

const svg = (content, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}" role="img" aria-label="AI融媒中心">${content}</svg>`

const CN = "'Source Han Sans CN','Noto Sans Hans',sans-serif"
const LAT = "'Inter','Helvetica Neue',sans-serif"

const lockup = (mark, c, ink) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 336 96" width="336" height="96">
  <g transform="translate(8 20) scale(0.58)">${mark(c)}</g>
  <text x="76" y="58" font-family="${CN}" font-size="35" font-weight="900" fill="${ink}" letter-spacing="0.5">AI融媒中心</text>
  <text x="78" y="78" font-family="${LAT}" font-size="10" font-weight="700" fill="${ink}" fill-opacity=".45" letter-spacing="3.2">AI MEDIA CENTER</text>
</svg>`

const col = (title, mark, small, note) => `
<div class="col">
  <div class="ctitle">${title}</div>
  <div class="big">${svg(mark(BLUE), 210)}</div>
  <div class="lockrow"><div class="card">${lockup(mark, BLUE, '#0B1220')}</div></div>
  <div class="lockrow"><div class="card dark">${lockup(mark, '#FFFFFF', '#FFFFFF')}</div></div>
  <div class="scale">
    ${[16, 22, 32, 48].map((s) => `<div class="s"><div class="sbox">${svg(s < 24 ? small(BLUE) : mark(BLUE), s)}</div><span>${s}</span></div>`).join('')}
    ${[22, 32].map((s) => `<div class="s"><div class="sbox dark">${svg(small('#FFFFFF'), s)}</div><span>${s} 深底</span></div>`).join('')}
  </div>
  <div class="note">${note}</div>
</div>`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1240px;background:#fff;padding:44px 46px;font-family:${CN};color:#0B1220}
h1{font-size:18px;font-weight:900}
.sub{font-family:${LAT};font-size:10.5px;letter-spacing:2.4px;color:#8A9099;margin-top:6px}
.rule{height:1px;background:#E6E9EE;margin:24px 0}
.cols{display:flex;gap:28px}
.col{flex:1;border:1px solid #EDF0F4;border-radius:12px;padding:22px}
.ctitle{font-size:12px;font-weight:900;letter-spacing:.6px;margin-bottom:14px}
.big{display:flex;justify-content:center;padding:10px 0 18px}
.card{border:1px solid #EDF0F4;border-radius:8px;padding:10px 12px;display:flex;justify-content:center}
.card.dark{background:#0F1520;border-color:#0F1520}
.lockrow{margin-bottom:10px}
.scale{display:flex;gap:20px;align-items:flex-end;margin-top:16px;padding:14px;background:#F7F8FA;border-radius:8px}
.s{display:flex;flex-direction:column;align-items:center;gap:7px}
.s span{font-family:${LAT};font-size:9.5px;color:#9AA3B0}
.sbox{display:flex;align-items:center;justify-content:center;height:48px;min-width:48px}
.sbox.dark{background:#0F1520;border-radius:6px;padding:0 6px}
.note{font-size:11px;line-height:1.85;color:#6A7280;margin-top:14px}
.note b{color:#0B1220}
</style></head><body>
<h1>AI融媒中心 · 标志候选 v2</h1>
<div class="sub">SIX-SOURCE RING · SINGLE INK · 96 GRID</div>
<div class="rule"></div>
<div class="cols">
${col('环甲 · 六段短弧（推荐）', markA2, markA2Sm, '<b>读法：</b>六个断口＝六个内容源与分发渠道，合成一圈；中心实心三角＝集中播发。<br><b>为什么推荐：</b>弧段让「环」真正成立 —— 原来六个孤立圆点读作节点图，不是环。22px 下六段自然并成整环，不会散成一圈点。<br><b>构造：</b>半径 34、每段跨 40°、间隙 20°、弧宽 6；三角外接 15.5、圆角 3.5。单色 #0B6FE0，无渐变。')}
${col('环乙 · 六个实心圆点', markA1, markA1Sm, '<b>读法：</b>六个圆点环绕，中心播发三角。最接近最早方案的形态。<br><b>代价：</b>六个等距圆点 + 中心三角，本质是「节点图 + 播放键」，行业属性偏弱；16px 下六点收缩后靠得近，环的读法会丢。<br><b>构造：</b>半径 34、点半径 6；三角外接 15.5。')}
</div>
<div class="rule" style="margin-bottom:16px"></div>
<div class="note" style="margin:0">
<b>相对最早方案改了三处：</b>① 半径统一为一套（原方案外环 5px、内芯 8px 是两个体系），标志回到单一几何；② 去掉双色渐变只留单色 —— 原来的青绿→蓝在浅底、深底、单色、反白四种场景派生五个色彩变体，是混乱源头；青绿降为辅色只用于 AI 激活点；③ 取消 compact 那套「砍外环」的独立标志，小尺寸改为同轮廓微调，所以任何尺寸都是同一个标。
</div>
</body></html>`

writeFileSync(resolve(OUT, 'candidates.html'), html)
console.log('ok')
