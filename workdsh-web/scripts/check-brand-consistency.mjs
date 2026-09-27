#!/usr/bin/env node
/**
 * 跨端品牌一致性校验（web ↔ 桌面）。
 *
 * 存在的理由：品牌资产曾经在四处各自演化——web 的信号环、桌面的鲸形、两套色值、
 * 一个手工二进制图标母版——而且没有任何检查会发现它们已经不一致。本脚本把
 * 「同一品牌」这件事变成**可执行的断言**，而不是靠人记得。
 *
 * 校验范围（纯静态，不依赖 sharp / sips，任意平台可跑）：
 *   1. 真源 assets/brand/brand.json 结构与色值格式；
 *   2. 真源声明的资产文件都存在；
 *   3. web 侧产物（brand-shape.ts、website/assets/mark*.svg）与真源一致；
 *   4. 桌面托盘 SVG 使用真源色，且桌面生成器**不再硬编码历史色值**；
 *   5. 桌面应用图标母版存在、且规格符合下游断言的硬要求
 *      （1024x1024 / 16-bit / RGBA）；
 *   6. 两端显示名同源（桌面 package.json 与自建旁路补丁）。
 *
 * 明确不校验（需要跑构建，本脚本无法替代）：
 *   - app-icon.png / *.ico / *.icns / tray-*.png 的**像素内容**是否由真源渲染而来。
 *     那需要 `yarn workspace dsh-plugin-desktop build`（sharp）与
 *     `scripts/desktop/build-desktop-icon.mjs`（sips/iconutil）实际执行。
 *     本脚本只保证规格与调色板来源正确，并打印现产物的 SHA-256 供人工比对。
 *
 * 用法：node scripts/check-brand-consistency.mjs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');
const DESKTOP_ROOT = join(REPO_ROOT, 'dsh-plugin-desktop');

const BRAND_JSON = join(WEB_ROOT, 'assets', 'brand', 'brand.json');
const TRAY_SVG = join(DESKTOP_ROOT, 'build', 'tray-icon.svg');
const APP_ICON = join(DESKTOP_ROOT, 'build', 'app-icon.png');
const DESKTOP_PKG = join(DESKTOP_ROOT, 'package.json');
const SIDECAR_EBC = join(
  WEB_ROOT, 'scripts', 'desktop', 'patches', 'upstream', 'apps', 'desktop', 'electron-builder.config.mjs',
);

/** 历史色值：真源化之后不应再出现在任何生成器里。 */
const LEGACY_COLORS = ['#176BFF', '#18CFE7'];
/** 桌面图标生成器（应全部经品牌真源取色，不得自行硬编码）。 */
const DESKTOP_GENERATORS = [
  'generate-brand-app-icon.mjs',
  'generate-tray-icons.mjs',
  'generate-windows-app-icon.mjs',
  'generate-mac-app-icon.mjs',
];

const problems = [];
const pass = (message) => console.log(`  \x1b[32m✓\x1b[0m ${message}`);
const fail = (message) => {
  problems.push(message);
  console.log(`  \x1b[31m✗\x1b[0m ${message}`);
};
const note = (message) => console.log(`  \x1b[33m·\x1b[0m ${message}`);

const rel = (file) => relative(REPO_ROOT, file);
const read = (file) => readFileSync(file, 'utf8');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * 去掉注释后再扫描"生成器里是否硬编码历史色值"。
 *
 * 理由：生成器**允许**出现历史色值的说明文字（「历史上这里硬编码 #176BFF」），
 * 那是文档、不是硬编码；而 `text.includes(color)` 会把它算成违规，导致
 * 门禁与注释互相打架（注释越诚实，检查越红）。所以必须先剥注释再扫。
 * `(^|[^:])` 守卫：不要把 `https://` 里的 `//` 当成行注释起点而截断整行。
 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 递归收集 JSON 值里的所有字符串（含数组与任意深度嵌套对象）。 */
const collectStrings = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
};

/** 读 PNG 头（IHDR），返回尺寸与位深/色彩类型；非 PNG 返回 undefined。 */
function pngHeader(file) {
  const buffer = readFileSync(file);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return undefined;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

console.log('品牌单一真源');
if (!existsSync(BRAND_JSON)) {
  fail(`缺少真源 ${rel(BRAND_JSON)}（应由 scripts/build-brand-assets.mjs 产出）`);
  console.log('\n结论：真源缺失，后续校验跳过。');
  process.exit(1);
}
const brand = JSON.parse(read(BRAND_JSON));
for (const [key, value] of [
  ['colors.signalFrom', brand.colors?.signalFrom],
  ['colors.signalTo', brand.colors?.signalTo],
  ['desktop.trayAccent', brand.desktop?.trayAccent],
]) {
  if (typeof value !== 'string' || !HEX.test(value)) fail(`${key} 不是合法十六进制色值：${value}`);
}
if (!problems.length) pass(`真源可解析，色值格式合法（signal ${brand.colors.signalFrom} → ${brand.colors.signalTo}）`);

console.log('\n真源声明的资产');
for (const [key, path] of Object.entries(brand.assets ?? {})) {
  if (existsSync(join(WEB_ROOT, path))) pass(`assets.${key} → ${path}`);
  else fail(`assets.${key} 指向的文件不存在：${path}`);
}

console.log('\nweb 侧产物与真源一致');
const brandShape = join(WEB_ROOT, 'packages', 'ui', 'src', 'components', 'brand-shape.ts');
if (!existsSync(brandShape)) {
  fail(`缺少 ${rel(brandShape)}`);
} else {
  const text = read(brandShape);
  for (const [label, value] of [
    ['from', brand.colors.signalFrom],
    ['to', brand.colors.signalTo],
  ]) {
    if (text.includes(`'${value}'`)) pass(`brand-shape.ts 的渐变 ${label} = ${value}`);
    else fail(`brand-shape.ts 与真源不一致：找不到渐变 ${label} 色值 ${value}`);
  }
}
for (const path of ['website/assets/mark.svg', 'website/assets/mark-ring.svg']) {
  if (existsSync(join(WEB_ROOT, path))) pass(path);
  else fail(`缺少 web 站点资产 ${path}`);
}

console.log('\n桌面托盘图标与生成器');
if (!existsSync(TRAY_SVG)) {
  fail(`缺少 ${rel(TRAY_SVG)}`);
} else {
  const tray = read(TRAY_SVG);
  const accent = brand.desktop.trayAccent;
  if (tray.includes(`fill="${accent}"`) || tray.includes(`stroke="${accent}"`)) {
    pass(`tray-icon.svg 使用真源色 ${accent}`);
  } else {
    fail(`tray-icon.svg 未使用真源色 ${accent}（可能仍是从前的品牌图形）`);
  }
  const legacyInTray = LEGACY_COLORS.filter((color) => tray.includes(`="${color}"`));
  if (legacyInTray.length) fail(`tray-icon.svg 仍含历史色值：${legacyInTray.join(', ')}`);
}
for (const name of DESKTOP_GENERATORS) {
  const file = join(DESKTOP_ROOT, 'scripts', name);
  if (!existsSync(file)) {
    fail(`缺少桌面图标生成器 scripts/${name}`);
    continue;
  }
  const text = read(file);
  const found = LEGACY_COLORS.filter((color) => stripComments(text).includes(color));
  if (found.length) fail(`scripts/${name} 仍硬编码历史色值：${found.join(', ')}`);
  else pass(`scripts/${name} 未硬编码历史色值`);
}

console.log('\n桌面应用图标母版规格');
if (!existsSync(APP_ICON)) {
  fail(`缺少 ${rel(APP_ICON)}`);
} else {
  const header = pngHeader(APP_ICON);
  if (!header) {
    fail('app-icon.png 不是合法 PNG');
  } else {
    const canvas = brand.desktop.appIconCanvas ?? 1024;
    if (header.width !== canvas || header.height !== canvas) {
      fail(`app-icon.png 尺寸应为 ${canvas}x${canvas}，实际 ${header.width}x${header.height}`);
    } else if (header.bitDepth !== 16 || header.colorType !== 6) {
      fail(`app-icon.png 应为 16-bit RGBA（bitDepth=16, colorType=6），实际 ${header.bitDepth}/${header.colorType}`);
    } else {
      pass(`app-icon.png 规格正确（${header.width}x${header.height}, ${header.bitDepth}-bit RGBA）`);
    }
    note(`app-icon.png SHA-256 ${sha256(APP_ICON)}`);
    note('像素内容是否由品牌真源渲染而来，需跑 `yarn workspace dsh-plugin-desktop build` 后复核');
  }
}

console.log('\n两端显示名同源');
const wanted = brand.desktop.productName;
if (existsSync(DESKTOP_PKG)) {
  const desktopPackage = JSON.parse(read(DESKTOP_PKG));
  if (desktopPackage.build?.productName === wanted) pass(`dsh-plugin-desktop productName = ${wanted}`);
  else fail(`dsh-plugin-desktop productName 为 ${desktopPackage.build?.productName}，真源期望 ${wanted}`);
  // 递归到任意深度：`build.mac.extendInfo.CFBundleDisplayName` 在第 3 层，
  // 早期只摊平 1 层的写法会漏掉它（盲区）。
  const legacyNames = collectStrings(desktopPackage.build ?? {}).filter((value) => value.includes('WorkDSH'));
  if (legacyNames.length) fail(`dsh-plugin-desktop 打包配置仍含 WorkDSH 字面量：${legacyNames.join(' | ')}`);
  else pass('dsh-plugin-desktop 打包配置无 WorkDSH 字面量');
} else {
  fail(`缺少 ${rel(DESKTOP_PKG)}`);
}
if (existsSync(SIDECAR_EBC)) {
  const sidecar = read(SIDECAR_EBC);
  if (sidecar.includes(`productName: '${wanted}'`)) pass(`自建旁路 electron-builder.config.mjs productName = ${wanted}`);
  else fail('自建旁路 electron-builder.config.mjs 的 productName 与真源不一致');
} else {
  note('未找到自建旁路 electron-builder.config.mjs（该链可能已废弃）');
}

console.log('\n桌面主进程源码里的 WorkDSH（清单，非失败项）');
const DESKTOP_SRC = join(DESKTOP_ROOT, 'src');
if (existsSync(DESKTOP_SRC)) {
  let total = 0;
  for (const name of readdirSync(DESKTOP_SRC).filter((file) => file.endsWith('.ts')).sort()) {
    const hits = read(join(DESKTOP_SRC, name)).split('\n')
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter(({ text }) => text.includes('WorkDSH'));
    if (!hits.length) continue;
    total += hits.length;
    note(`src/${name}：${hits.length} 处（${hits.map((hit) => `L${hit.line}`).join(', ')}）`);
  }
  if (total === 0) pass('src/ 已无 WorkDSH');
  else {
    note(`共 ${total} 处。判据：主语是「产物身份」（runtime / launcher / Profile / bundle / worker arguments）`);
    note('保留代号 workdsh 是对的——它对应 profiles/workdsh、workdsh-runtime、workdsh-bundle 这些真实路径与包名；');
    note('主语是「运行中的应用」（failed to start / cannot replace / reopen / cannot update）则必须走 brand.generated.ts 常量。');
  }
}

console.log('');
if (problems.length) {
  console.log(`\x1b[31m品牌一致性校验未通过：${problems.length} 项\x1b[0m`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log('\x1b[32m品牌一致性校验通过\x1b[0m');
