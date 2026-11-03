// AI融媒中心 · 品牌系统（唯一源）v3
// 标志「六源播发」：六段短弧环绕＝六个内容源与分发渠道；中心实心三角＝集中播发。
// 语义取自最早方案，几何重做：半径统一为一套、单色无渐变、任何尺寸都是同一个标志。
// 本文件一次产出：全部 SVG 资产、配色 token（CSS/JSON）、品牌系统总览页。
// 运行：node build/brand.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..')

const B = {
  cn: 'AI融媒中心',
  en: 'AI MEDIA CENTER',
  primary: '#0B6FE0',
  primaryDark: '#3D93FF',
  accent: '#12D6B0',
  ink: '#0B1220',
  tile: '#0F1520',
}

/* ---------- 几何常数（96 网格） ---------- */
const G = 96
const C = 48
const RING_R = 35 // 外环半径
const ARC_W = 6 // 弧宽
const SPAN = 18 // 每段弧 ±18° ⇒ 跨 36°，间隙 24°
const TRI_R = 13.5 // 中心三角外接半径
const TRI_CX = 47 // 三角中心左移 1px，平衡左右留白
const TRI_STROKE = 7 // 圆角三角

const rad = (d) => (d * Math.PI) / 180
const n = (v) => Math.round(v * 100) / 100
const pt = (r, deg, cx = C) => [n(cx + r * Math.cos(rad(deg))), n(C + r * Math.sin(rad(deg)))]

const ANGLES = [-90, -30, 30, 90, 150, 210]

const arcRing = (c, span = SPAN, w = ARC_W, r = RING_R) =>
  ANGLES.map((a) => {
    const [x1, y1] = pt(r, a - span)
    const [x2, y2] = pt(r, a + span)
    return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`
  }).join('')

const TRI = (() => {
  const t = [[TRI_CX + TRI_R, C], ...[-122, 122].map((d) => pt(TRI_R, d, TRI_CX))]
  return `M${t[0][0]} ${t[0][1]}L${t[1][0]} ${t[1][1]}L${t[2][0]} ${t[2][1]}Z`
})()

/** 三角路径：外接半径、中心 x、圆角笔画宽度均可变，供紧凑档复用。 */
const triPath = (c, r, cx, sw) => {
  const t = [[cx + r, C], ...[-122, 122].map((d) => pt(r, d, cx))]
  return `<path d="M${t[0][0]} ${t[0][1]}L${t[1][0]} ${t[1][1]}L${t[2][0]} ${t[2][1]}Z" fill="${c}" stroke="${c}" stroke-width="${sw}" stroke-linejoin="round"/>`
}

const MARK = (c, span = SPAN) => `<g>${arcRing(c, span)}<path d="${TRI}" fill="${c}" stroke="${c}" stroke-width="${TRI_STROKE}" stroke-linejoin="round"/></g>`

/** 紧凑档：<32px 使用的光学补偿几何。结构与标准档完全相同，只加粗弧、收间隙、放大三角。 */
const MARK_SM = (c) => `<g>${arcRing(c, 20, 7.5, 34)}${triPath(c, 15, 46, 8)}</g>`
const SM_BELOW = 32

const svg = (content, size, w = G, h = G) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${size}" height="${Math.round((size * h) / w)}" role="img" aria-label="${B.cn}">${content}</svg>`

const CN = "'Source Han Sans CN', 'Noto Sans Hans', sans-serif"
const LAT = "'Inter', 'Helvetica Neue', sans-serif"

/* ---------- 横版组合 ---------- */
function lockupH({ dark = false } = {}) {
  const ink = dark ? '#FFFFFF' : B.ink
  const col = dark ? '#FFFFFF' : B.primary
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 336 96" width="336" height="96" role="img" aria-label="${B.cn}">
  <g transform="translate(6 18) scale(0.6)">${MARK(col)}</g>
  <text x="76" y="57" font-family="${CN}" font-size="35" font-weight="900" fill="${ink}" letter-spacing="0.5">${B.cn}</text>
  <text x="78" y="77" font-family="${LAT}" font-size="10" font-weight="700" fill="${ink}" fill-opacity="0.45" letter-spacing="3.2">${B.en}</text>
</svg>`
}

/* ---------- 竖版组合 ---------- */
function lockupV({ dark = false } = {}) {
  const ink = dark ? '#FFFFFF' : B.ink
  const col = dark ? '#FFFFFF' : B.primary
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 196" width="240" height="196" role="img" aria-label="${B.cn}">
  <g transform="translate(72 8)">${MARK(col)}</g>
  <text x="120" y="140" text-anchor="middle" font-family="${CN}" font-size="30" font-weight="900" fill="${ink}" letter-spacing="1">${B.cn}</text>
  <text x="120" y="166" text-anchor="middle" font-family="${LAT}" font-size="10" font-weight="700" fill="${ink}" fill-opacity="0.45" letter-spacing="3">${B.en}</text>
</svg>`
}

/* ---------- 应用图标 512 ---------- */
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${B.cn}">
  <rect width="512" height="512" rx="106.67" fill="${B.tile}"/>
  <g transform="translate(38 38) scale(4.54)">${MARK('#FFFFFF')}</g>
</svg>`

mkdirSync(resolve(OUT, 'svg'), { recursive: true })
writeFileSync(resolve(OUT, 'svg/mark.svg'), svg(MARK(B.primary), G))
writeFileSync(resolve(OUT, 'svg/mark-mono.svg'), svg(MARK('#000000'), G))
writeFileSync(resolve(OUT, 'svg/mark-inverse.svg'), svg(MARK('#FFFFFF'), G))
writeFileSync(resolve(OUT, 'svg/lockup-h.svg'), lockupH())
writeFileSync(resolve(OUT, 'svg/lockup-h-dark.svg'), lockupH({ dark: true }))
writeFileSync(resolve(OUT, 'svg/lockup-v.svg'), lockupV())
writeFileSync(resolve(OUT, 'svg/lockup-v-dark.svg'), lockupV({ dark: true }))
writeFileSync(resolve(OUT, 'svg/app-icon.svg'), icon)
// 小尺寸降级档（<24px 使用，同一轮廓）
writeFileSync(resolve(OUT, 'svg/mark-sm.svg'), svg(MARK_SM(B.primary), G))
writeFileSync(resolve(OUT, 'svg/mark-sm-inverse.svg'), svg(MARK_SM('#FFFFFF'), G))

/* ---------- 配色 token ---------- */
const light = {
  'brand-primary': '#0B6FE0',
  'brand-primary-hover': '#0A62C8',
  'brand-primary-active': '#0852A8',
  'brand-primary-subtle': '#E8F1FE',
  'brand-accent': '#12D6B0',
  'bg-canvas': '#FFFFFF',
  'bg-surface': '#F7F8FA',
  'bg-raised': '#FFFFFF',
  'border-default': '#E4E8EE',
  'border-strong': '#CBD3DE',
  'text-primary': '#0B1220',
  'text-secondary': '#5A6270',
  'text-tertiary': '#9AA3B0',
  'state-success': '#16A34A',
  'state-warning': '#D97706',
  'state-danger': '#DC2626',
}
const dark = {
  'brand-primary': '#3D93FF',
  'brand-primary-hover': '#6BAEFF',
  'brand-primary-active': '#0B6FE0',
  'brand-primary-subtle': '#122A45',
  'brand-accent': '#2AE3C0',
  'bg-canvas': '#121212',
  'bg-surface': '#202020',
  'bg-raised': '#242424',
  'border-default': '#343434',
  'border-strong': '#4A4A4A',
  'text-primary': '#E7E7E7',
  'text-secondary': '#A5A5A5',
  'text-tertiary': '#6E6E6E',
  'state-success': '#3FB96B',
  'state-warning': '#E0A63F',
  'state-danger': '#F06161',
}

const cssVars = (obj) => Object.entries(obj).map(([k, v]) => `  --${k}: ${v};`).join('\n')
writeFileSync(resolve(OUT, 'tokens.css'), `/* AI融媒中心 · 应用配色 token。由 build/brand.mjs 生成，勿手改。 */
:root {
${cssVars(light)}
}

[data-theme="dark"], .dark {
${cssVars(dark)}
}

/* 面积配比：中性 80% / 主色 15% / 辅色 5%。
   主色仅用于主按钮、选中态、链接、标志、关键数据。
   辅色仅用于 AI 激活点、实时态、标志强调，不做大面积填充。 */
`)
writeFileSync(
  resolve(OUT, 'tokens.json'),
  JSON.stringify({ brand: B, light, dark, ratio: { neutral: 0.8, primary: 0.15, accent: 0.05 } }, null, 2),
)

/* ---------- 系统总览页 ---------- */
const sw = (name, hex) =>
  `<div class="sw"><div class="chip" style="background:${hex}"></div><div class="swmeta"><b>${name}</b><span>${hex}</span></div></div>`

const swGroup = (title, obj, keys) =>
  `<div class="group"><div class="gtitle">${title}</div><div class="sws">${keys.map((k) => sw(k, obj[k])).join('')}</div></div>`

const sizes = [16, 22, 32, 48, 96]

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1400px;background:#fff;color:${B.ink};font-family:${CN};padding:48px 52px 44px}
  h1{font-size:19px;font-weight:900}
  .sub{font-family:${LAT};font-size:11px;letter-spacing:2.6px;color:#7A8290;margin-top:7px;text-transform:uppercase}
  .rule{height:1px;background:#E4E8EE;margin:26px 0}
  .h{font-size:13px;font-weight:900;letter-spacing:1px;margin-bottom:16px}
  .h span{font-family:${LAT};font-weight:400;color:#9AA3B0;font-size:11px;letter-spacing:1px;margin-left:10px}
  .hero{display:flex;gap:40px;align-items:center}
  .hero .mark{flex:0 0 300px;display:flex;justify-content:center}
  .hero .txt{flex:1;font-size:13px;line-height:2.05;color:#5A6270;max-width:560px}
  .hero .txt b{color:${B.ink}}
  .row{display:flex;gap:24px}
  .card{border:1px solid #EDF0F4;border-radius:10px;padding:26px;display:flex;align-items:center;justify-content:center;background:#fff}
  .card.dark{background:#121212;border-color:#121212}
  .half{flex:1}
  .band{background:#F7F8FA;border-radius:10px;padding:26px;display:flex;gap:40px;align-items:center}
  .group{margin-bottom:18px}
  .gtitle{font-size:11px;font-weight:900;letter-spacing:1px;color:#5A6270;margin-bottom:10px}
  .sws{display:flex;flex-wrap:wrap;gap:10px}
  .sw{display:flex;align-items:center;gap:9px;border:1px solid #EDF0F4;border-radius:8px;padding:8px 12px 8px 8px;min-width:186px}
  .chip{width:30px;height:30px;border-radius:6px;border:1px solid rgba(0,0,0,.06)}
  .swmeta{display:flex;flex-direction:column;gap:2px}
  .swmeta b{font-family:${LAT};font-size:10.5px;font-weight:700}
  .swmeta span{font-family:${LAT};font-size:10.5px;color:#7A8290}
  .cols{display:flex;gap:36px}
  .col{flex:1}
  .ratio{display:flex;height:34px;border-radius:8px;overflow:hidden;font-family:${LAT};font-size:11px;font-weight:700;color:#fff}
  .ratio div{display:flex;align-items:center;justify-content:center}
  .note{font-size:11px;color:#7A8290;line-height:1.95;margin-top:12px}
  .smallrow{display:flex;gap:30px;align-items:flex-end}
  .small{display:flex;flex-direction:column;align-items:center;gap:10px}
  .num{font-family:${LAT};font-size:10px;color:#9AA3B0}
  .mis{display:flex;gap:18px}
  .mis .m{flex:1;border:1px solid #EDF0F4;border-radius:10px;padding:16px;text-align:center}
  .mis .m .cap{font-size:10.5px;color:#B03636;margin-top:10px;font-weight:700}
  .mis .m .box{height:104px;display:flex;align-items:center;justify-content:center}
</style></head><body>
  <h1>${B.cn} · 品牌系统</h1>
  <div class="sub">${B.en} — identity & color system · 96 grid · single ink</div>
  <div class="rule"></div>

  <div class="hero">
    <div class="mark">${svg(MARK(B.primary), 300)}</div>
    <div class="txt">
      <b>标志「六源播发」。</b>六段弧环绕成环，六个断口＝六个内容源与分发渠道；中心实心三角＝集中播发。<br>
      读法：内容从六个方向汇入，经中心处理后单向播发 —— 环是来源的广度，三角是出口的唯一。<br>
      构造：96×96 网格；外环半径 35，每段跨 36°、间隙 24°、弧宽 6，圆头线端；中心三角外接 13.5，圆角 3.5。<br>
      单色，无渐变。缩小到 16px 时六段并成整环，仍是同一个标志。
    </div>
  </div>

  <div class="rule"></div>
  <div class="h">组合 <span>LOCKUPS</span></div>
  <div class="row">
    <div class="card half">${lockupH()}</div>
    <div class="card half dark">${lockupH({ dark: true })}</div>
  </div>
  <div class="row" style="margin-top:24px">
    <div class="card half">${lockupV()}</div>
    <div class="card half dark">${lockupV({ dark: true })}</div>
  </div>

  <div class="rule"></div>
  <div class="h">应用图标与小尺寸 <span>APP ICON / SCALING</span></div>
  <div class="band">
    <div>${icon.replace('width="512" height="512"', 'width="132" height="132"')}</div>
    <div class="smallrow">
      ${sizes
        .map(
          (s) =>
            `<div class="small">${svg(s < SM_BELOW ? MARK_SM(B.primary) : MARK(B.primary), s)}<span class="num">${s}</span></div>`,
        )
        .join('')}
    </div>
    <div class="smallrow" style="margin-left:auto">
      ${[22, 32]
        .map(
          (s) =>
            `<div class="small"><div style="background:#121212;padding:8px;border-radius:6px">${svg(MARK_SM('#FFFFFF'), s)}</div><span class="num">${s} 深底</span></div>`,
        )
        .join('')}
    </div>
  </div>

  <div class="rule"></div>
  <div class="h">配色系统 <span>COLOR TOKENS · LIGHT / DARK</span></div>
  <div class="cols">
    <div class="col">
      ${swGroup('品牌色', light, ['brand-primary', 'brand-primary-hover', 'brand-primary-active', 'brand-primary-subtle', 'brand-accent'])}
      ${swGroup('浅色 · 界面', light, ['bg-canvas', 'bg-surface', 'border-default', 'text-primary', 'text-secondary', 'text-tertiary'])}
      ${swGroup('语义色', light, ['state-success', 'state-warning', 'state-danger'])}
    </div>
    <div class="col">
      ${swGroup('深色 · 品牌色', dark, ['brand-primary', 'brand-primary-hover', 'brand-primary-subtle', 'brand-accent'])}
      ${swGroup('深色 · 界面', dark, ['bg-canvas', 'bg-surface', 'bg-raised', 'border-default', 'text-primary', 'text-secondary'])}
      ${swGroup('深色 · 语义色', dark, ['state-success', 'state-warning', 'state-danger'])}
    </div>
  </div>

  <div class="rule"></div>
  <div class="h">使用方法与禁用 <span>USAGE / MISUSE</span></div>
  <div class="ratio">
    <div style="width:80%;background:#202020">中性 80%</div>
    <div style="width:15%;background:${B.primary}">主色 15%</div>
    <div style="width:5%;background:${B.accent};color:#0B1220">辅色 5%</div>
  </div>
  <div class="note">
    主色仅用于：主按钮、选中态、链接、标志、关键数据强调。辅色仅用于：AI 激活点、实时状态、标志强调，不大面积填充。<br>
    深底下主色提亮为 #3D93FF（同色相，保对比度）；浅色物料上标志仍用 #0B6FE0。
  </div>
  <div class="mis" style="margin-top:20px">
    <div class="m"><div class="box"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="88" height="88"><g transform="rotate(18 48 48)">${MARK(B.primary)}</g></svg></div><div class="cap">不旋转</div></div>
    <div class="m"><div class="box"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="88" height="88"><defs><linearGradient id="mx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13D6AA"/><stop offset="1" stop-color="#21A8ED"/></linearGradient></defs>${MARK('url(#mx)')}</svg></div><div class="cap">不加渐变</div></div>
    <div class="m"><div class="box"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="88" height="88"><g transform="scale(1.22) translate(-8.5 -8.5)">${MARK(B.primary)}</g></svg></div><div class="cap">不留白不足</div></div>
    <div class="m"><div class="box"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="110" height="84" preserveAspectRatio="none">${MARK(B.primary)}</svg></div><div class="cap">不拉伸变形</div></div>
  </div>
</body></html>`

writeFileSync(resolve(OUT, 'system.html'), html)
console.log('brand system written')
