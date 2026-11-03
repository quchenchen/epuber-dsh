// AI融媒中心 · 标志候选 v3 —— 中心符号两种做法
// 外环固定为「六段短弧」（v2 已验：环的读法成立、小尺寸并环不散）
// 分歧只在中心：播发三角 vs 信号源

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..')

const C = 48
const RING_R = 35
const BLUE = '#0B6FE0'
const SPAN = 18

const rad = (d) => (d * Math.PI) / 180
const n = (v) => Math.round(v * 100) / 100
const pt = (r, deg) => [n(C + r * Math.cos(rad(deg))), n(C + r * Math.sin(rad(deg)))]

const ANGLES = [-90, -30, 30, 90, 150, 210]

// 外环：六段短弧
const arcRing = (c, span = SPAN, w = 6, r = RING_R) =>
  ANGLES.map((a) => {
    const [x1, y1] = pt(r, a - span)
    const [x2, y2] = pt(r, a + span)
    return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`
  }).join('')

// 中心甲：实心三角（外接 14 + 7 笔宽 ⇒ 视觉 ≈17.5）
const TRI = (() => {
  const t = [[C + 14, C], ...[-122, 122].map((d) => pt(14, d))]
  return `M${t[0][0]} ${t[0][1]}L${t[1][0]} ${t[1][1]}L${t[2][0]} ${t[2][1]}Z`
})()
const coreTri = (c) => `<path d="${TRI}" fill="${c}" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>`

// 中心乙：实心圆 r=9 + 右向扩散弧（半径 18，跨 ±58°，宽 6）
const coreSignal = (c) => {
  const [x1, y1] = pt(18, -58)
  const [x2, y2] = pt(18, 58)
  return `<circle cx="${C}" cy="${C}" r="9" fill="${c}"/>
  <path d="M${x1} ${y1} A18 18 0 0 1 ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`
}

const markTri = (c, span = SPAN) => `<g>${arcRing(c, span)}${coreTri(c)}</g>`
const markSig = (c, span = SPAN) => `<g>${arcRing(c, span)}${coreSignal(c)}</g>`

// 小尺寸：间隙收窄，让六段并得更紧（同一轮廓，不是另一个标志）
const TRI_SM = (c) => markTri(c, 21)
const SIG_SM = (c) => markSig(c, 21)

const svg = (content, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}" role="img" aria-label="AI融媒中心">${content}</svg>`

const CN = "'Source Han Sans CN','Noto Sans Hans',sans-serif"
const LAT = "'Inter','Helvetica Neue',sans-serif"

const lockup = (mark, c, ink) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 336 96" width="336" height="96">
  <g transform="translate(8 20) scale(0.58)">${mark(c)}</g>
  <text x="76" y="58" font-family="${CN}" font-size="35" font-weight="900" fill="${ink}" letter-spacing="0.5">AI融媒中心</text>
  <text x="78" y="78" font-family="${LAT}" font-size="10" font-weight="700" fill="${ink}" fill-opacity=".45" letter-spacing="3.2">AI MEDIA CENTER</text>
</svg>`

const iconTile = (mark, size = 104) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}"><rect width="96" height="96" rx="21" fill="#0F1520"/><g transform="translate(9 9) scale(0.8125)">${mark('#FFFFFF')}</g></svg>`

const col = (title, mark, small, note) => `
<div class="col">
  <div class="ctitle">${title}</div>
  <div class="big">${svg(mark(BLUE), 200)}</div>
  <div class="lockrow"><div class="card">${lockup(mark, BLUE, '#0B1220')}</div></div>
  <div class="lockrow"><div class="card dark">${lockup(mark, '#FFFFFF', '#FFFFFF')}</div></div>
  <div class="scale">
    ${[16, 22, 32, 48].map((s) => `<div class="s"><div class="sbox">${svg(s < 24 ? small(BLUE) : mark(BLUE), s)}</div><span>${s}</span></div>`).join('')}
    ${[22, 32].map((s) => `<div class="s"><div class="sbox dark">${svg(small('#FFFFFF'), s)}</div><span>${s} 深底</span></div>`).join('')}
    <div class="s">${iconTile(mark, 62)}<span>APP</span></div>
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
.scale{display:flex;gap:16px;align-items:flex-end;margin-top:16px;padding:14px;background:#F7F8FA;border-radius:8px}
.s{display:flex;flex-direction:column;align-items:center;gap:7px}
.s span{font-family:${LAT};font-size:9.5px;color:#9AA3B0}
.sbox{display:flex;align-items:center;justify-content:center;height:48px;min-width:40px}
.sbox.dark{background:#0F1520;border-radius:6px;padding:0 6px}
.note{font-size:11px;line-height:1.85;color:#6A7280;margin-top:14px}
.note b{color:#0B1220}
</style></head><body>
<h1>AI融媒中心 · 标志候选 v3</h1>
<div class="sub">SIX-SOURCE RING · CENTER SIGN — SINGLE INK · 96 GRID</div>
<div class="rule"></div>
<div class="cols">
${col('甲 · 中心播发三角（推荐）', markTri, TRI_SM, '<b>读法：</b>六段弧的六个断口＝六个内容源与分发渠道；中心实心三角＝集中播发。<br><b>优势：</b>符号最凝练，16px 下三角轮廓仍然靠得住；与「六源 → 汇聚 → 播发」的叙事完全对齐。<br><b>代价：</b>三角在这个语境里天然带「播放」联想，需要靠字标和应用体系把它拉回「融媒」。')}
${col('乙 · 中心信号源', markSig, SIG_SM, '<b>读法：</b>中心点发出右向弧，与外环形成同心辐射；中心是源，外环是覆盖。<br><b>优势：</b>脱离「播放键」联想，语义更纯 —— 信号从中心发出、六向抵达。<br><b>代价：</b>多一层弧线，16px 下中心点与右弧会开始粘连，需要靠降级版收间隙。')}
</div>
<div class="rule" style="margin-bottom:16px"></div>
<div class="note" style="margin:0">
<b>两版共用的构造：</b>96 网格，外环半径 35、每段跨 36°、间隙 24°、弧宽 6，圆头线端；单色 #0B6FE0，无渐变。<br>
<b>小尺寸规则：</b>&lt;24px 时把每段跨度从 36° 收到 42°，六段并得更紧 —— 同一轮廓，不是第二个标志。<br>
<b>相对最早方案改了三处：</b>① 半径统一为一套（原方案外环 5px、内芯 8px 是两个体系）；② 去掉双色渐变只留单色，青绿降为辅色仅用于 AI 激活点；③ 取消 compact 那套「砍外环」的独立标志。
</div>
</body></html>`

writeFileSync(resolve(OUT, 'candidates.html'), html)
console.log('ok')
