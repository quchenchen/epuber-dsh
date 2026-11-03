// AI融媒中心 · 标志生成源（唯一源）v4 —— 曲线版
// 96×96 网格，单一颜色。v3 全是直角与矩形，评审意见是"方正太硬"，因此本版全部引入圆弧与圆角：
//   D1 柔叠  = B「叠」的软化：两个圆角方叠压，交叠处收成一个正圆内核
//   D2 聚    = 新方向：左右双弧相向，中间一个实心圆 —— 两侧汇于一点
//   D3 序柔  = C「序」的软化：三级递进不再走直角阶梯，改沿弧线抬升

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..')

export const BRAND = {
  cn: 'AI融媒中心',
  en: 'AI MEDIA CENTER',
  primary: '#176BFF',
  ink: '#0B1220',
}

const G = 96
const S = 11 // 笔画 11/96：略重于 v3 的 10，但配圆头后视觉更柔

const rad = (d) => (d * Math.PI) / 180
const pt = (cx, cy, r, deg) => {
  const a = rad(deg)
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
const n = (v) => Math.round(v * 100) / 100

/* ---------- D1「柔叠」 ----------
   两个圆角方对角叠压；交叠区（34..62 见方）被一个 r=14 的正圆顶替。
   圆形内核 = 融合产生的那一点。 */
const D1 = `
  <g mask="url(#core)">
    <rect x="10" y="10" width="50" height="50" rx="17" />
    <rect x="36" y="36" width="50" height="50" rx="17" />
  </g>
  <mask id="core" maskUnits="userSpaceOnUse" x="0" y="0" width="${G}" height="${G}">
    <rect x="0" y="0" width="${G}" height="${G}" fill="#fff" />
    <circle cx="48" cy="48" r="12" fill="#000" />
  </mask>`

/* ---------- D2「聚」 ----------
   左右各一段 120° 圆弧相向，上下各留 60° 开口；中心一个实心圆。 */
function arc(cx, cy, r, a1, a2) {
  const [x1, y1] = pt(cx, cy, r, a1)
  const [x2, y2] = pt(cx, cy, r, a2)
  return `M${n(x1)} ${n(y1)} A${r} ${r} 0 0 1 ${n(x2)} ${n(y2)}`
}
const D2 = `
  <path d="${arc(48, 48, 36, 120, 240)}" fill="none" stroke-width="${S}" stroke-linecap="round" />
  <path d="${arc(48, 48, 36, -60, 60)}" fill="none" stroke-width="${S}" stroke-linecap="round" />
  <circle cx="48" cy="48" r="13" stroke="none" />`

/* ---------- D3「序·柔」 ----------
   三个圆角方沿浅弧由左下向右上递进放大；圆角随尺寸同比放大，节奏统一。 */
const D3 = `
  <rect x="9" y="60" width="18" height="18" rx="6" stroke="none" />
  <rect x="33" y="42" width="24" height="24" rx="8" stroke="none" />
  <rect x="61" y="16" width="30" height="30" rx="10" stroke="none" />`

const marks = [
  { id: 'd1', name: 'D1 柔叠', body: D1, filled: true, note: '圆角方叠压，交叠处收成正圆内核' },
  { id: 'd2', name: 'D2 聚', body: D2, filled: false, note: '双弧相向，中间一点：两侧汇于一处' },
  { id: 'd3', name: 'D3 序·柔', body: D3, filled: true, note: '三级沿弧抬升，去掉了直角阶梯' },
]

/* 显式传色，不用 currentColor（v2 的深底失效栽在这） */
function markInner(m, color) {
  if (m.filled) return `<g fill="${color}">${m.body}</g>`
  return `<g fill="${color}" stroke="${color}">${m.body}</g>`
}

const svg = (m, color, size = G) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" width="${size}" height="${size}" role="img" aria-label="${BRAND.cn}">${markInner(m, color)}</svg>`

const CN = "'Source Han Sans CN', 'Noto Sans Hans', sans-serif"
const LAT = "'Source Sans Pro', 'Helvetica Neue', sans-serif"

/* 横版：图形 48 高（em 的 1.33 倍），光学中线对齐 */
const LOCK_W = 330
function lockup(m, { dark = false } = {}) {
  const ink = dark ? '#FFFFFF' : BRAND.ink
  const col = dark ? '#FFFFFF' : BRAND.primary
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOCK_W} 96" width="${LOCK_W}" height="96" role="img" aria-label="${BRAND.cn}">
  <g transform="translate(10 24) scale(0.5)">${markInner(m, col)}</g>
  <text x="78" y="61" font-family="${CN}" font-size="36" font-weight="900" fill="${ink}" letter-spacing="0.5">${BRAND.cn}</text>
  <text x="80" y="81" font-family="${LAT}" font-size="10.5" font-weight="700" fill="${ink}" fill-opacity="0.5" letter-spacing="3.4">${BRAND.en}</text>
</svg>`
}

mkdirSync(resolve(OUT, 'svg'), { recursive: true })
for (const m of marks) {
  writeFileSync(resolve(OUT, `svg/${m.id}.svg`), svg(m, BRAND.primary))
  writeFileSync(resolve(OUT, `svg/${m.id}-mono.svg`), svg(m, '#000000'))
  writeFileSync(resolve(OUT, `svg/${m.id}-inverse.svg`), svg(m, '#FFFFFF'))
  writeFileSync(resolve(OUT, `svg/${m.id}-lockup.svg`), lockup(m))
  writeFileSync(resolve(OUT, `svg/${m.id}-lockup-dark.svg`), lockup(m, { dark: true }))
}

/* ---------- 评审页 ---------- */
const SIZES = [16, 22, 32, 48]
const cell = (m, { dark = false, size = 240, cap = '' } = {}) =>
  `<div class="cell${dark ? ' dark' : ''}">${svg(m, dark ? '#FFFFFF' : BRAND.primary, size)}<span class="cap${dark ? ' solid' : ''}">${cap}</span></div>`
const smallRow = (m) =>
  SIZES.map((s) => `<div class="small">${svg(m, BRAND.primary, s)}<span class="num">${s}</span></div>`).join('')

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;background:#fff;color:${BRAND.ink};font-family:${CN};padding:46px 48px 42px}
  h1{font-size:17px;font-weight:900;letter-spacing:.4px}
  .sub{font-family:${LAT};font-size:11px;letter-spacing:2.4px;color:#7A8290;margin-top:7px;text-transform:uppercase}
  .rule{height:1px;background:#E4E8EE;margin:24px 0}
  .row{display:flex;gap:24px}
  .cell{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:28px 14px;border:1px solid #EDF0F4;border-radius:8px;background:#fff}
  .cell.dark{background:#121212;border-color:#121212}
  .cap{font-size:11px;color:#7A8290;line-height:1.6;text-align:center;max-width:214px}
  .cap b{display:block;font-size:13px;font-weight:900;color:${BRAND.ink};margin-bottom:4px;letter-spacing:.3px}
  .cap.solid{color:#fff}
  .cap.solid b{color:#fff}
  .small{display:flex;flex-direction:column;align-items:center;gap:10px}
  .num{font-family:${LAT};font-size:10px;color:#9AA3B0}
  .band{display:flex;gap:34px;align-items:center;padding:22px 26px;border-radius:8px;background:#F7F8FA}
  .band.dark{background:#121212}
  .h{font-size:12px;font-weight:900;letter-spacing:1.2px;color:#5A6270;margin-bottom:14px}
  .lk{display:flex;flex-direction:column;gap:12px}
</style></head><body>
  <h1>${BRAND.cn} · 标志方向评审 v4</h1>
  <div class="sub">${BRAND.en} — curve study · 96 grid · stroke ${S} · single ink</div>
  <div class="rule"></div>
  <div class="row">${marks.map((m) => cell(m, { cap: `<b>${m.name}</b>${m.note}` })).join('')}</div>
  <div class="rule"></div>
  <div class="h">小尺寸辨识 · 实际像素渲染 16 / 22 / 32 / 48</div>
  <div class="row">${marks.map((m) => `<div class="cell" style="gap:20px">${smallRow(m)}</div>`).join('')}</div>
  <div class="rule"></div>
  <div class="h">产品深底 #121212 · 单色反白</div>
  <div class="band dark">
    ${marks.map((m) => `<div class="small">${svg(m, '#FFFFFF', 92)}<span class="num" style="color:#fff;opacity:.45">92</span></div>`).join('')}
    ${marks.map((m) => `<div class="small">${svg(m, '#FFFFFF', 22)}<span class="num" style="color:#fff;opacity:.45">22</span></div>`).join('')}
  </div>
  <div class="rule"></div>
  <div class="h">横版组合 · 浅底 / 深底</div>
  <div class="lk">${marks.map((m) => `<div class="band">${lockup(m)}</div><div class="band dark">${lockup(m, { dark: true })}</div>`).join('')}</div>
</body></html>`

writeFileSync(resolve(OUT, 'sheet.html'), html)
console.log('ok')
