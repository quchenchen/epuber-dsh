#!/usr/bin/env node
/**
 * 「AI融媒中心」桌面应用图标（workdsh-icon.icns）生成与校验。
 *
 * 图形唯一来源：assets/brand/ai-rongmei-icon.svg（由 scripts/build-brand-assets.mjs 产出）。
 * 本脚本是该 SVG 到 macOS icns 的唯一生成路径，产出物即桌面打包补丁
 * scripts/desktop/patches/upstream/apps/desktop/workdsh-icon.icns，
 * 由 patches/upstream/apps/desktop/electron-builder.config.mjs 的 mac.icon 引用。
 *
 * 为什么不并进 build-brand-assets.mjs：那个脚本只产 SVG 与 TS，跨平台、无外部工具依赖；
 * sips / iconutil 仅 macOS 可用，把这一步留在桌面目录才不污染品牌资产的跨平台性。
 *
 * ⚠️ 换图标不是改完这里就完事：`workdsh-icon.icns` 是 pack-desktop.mjs 的 9 个补丁之一，
 * 该脚本每次运行都会拿补丁存档与本机快照（.artifacts/desktop-pack-test/upstream）逐文件
 * SHA-256 比对。所以重新生成 icns 之后，**必须让快照里的同名文件同步更新**
 * （改快照 → `pack-desktop.mjs --sync-patches`），否则 --check-only 会以
 * 「快照与补丁存档不一致」直接失败。快照不存在时无法完成这一步。
 * 品牌真源见 assets/brand/brand.json（由 build-brand-assets.mjs 产出）。
 *
 * 背景：快照内曾长期留着一枚由更早旧标识资产（workdsh-logo-concept.png，该源文件不在仓库内）
 * 生成的 icns，源与产物脱钩后无法复核。本脚本把「源 → 10 档 iconset → icns」固化成可重跑路径，
 * --check 比对的是逐档 PNG 内容，容器级差异（若有）不影响判定。
 *
 * 用法:
 *   node scripts/desktop/build-desktop-icon.mjs          # 从 SVG 重新生成 icns，打印容器 SHA-256
 *   node scripts/desktop/build-desktop-icon.mjs --check  # 只校验：现有 icns 与 SVG 是否逐档一致（不写文件）
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..', '..');
const ICON_SOURCE = join(WORKSPACE_ROOT, 'assets', 'brand', 'ai-rongmei-icon.svg');
const ICNS_TARGET = join(SCRIPT_DIR, 'patches', 'upstream', 'apps', 'desktop', 'workdsh-icon.icns');

/** macOS iconset 的 10 档：像素边长 → iconset 内文件名。 */
const ICONSET_ENTRIES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

const checkOnly = process.argv.slice(2).includes('--check');

function fail(message) {
  console.error(`\n[build-desktop-icon] ERROR: ${message}`);
  process.exit(1);
}

function runCapture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.error !== undefined) fail(`${command} 无法执行: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} 退出码 ${result.status}: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function pngSize(file) {
  const numbers = runCapture('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file])
    .split('\n')
    .map((line) => Number(line.split(':').pop()?.trim()))
    .filter((value) => Number.isInteger(value));
  return { width: numbers[0], height: numbers[1] };
}

/** 用 sips 把 SVG 直接栅格化到目标尺寸（每档独立渲染，避免放大位图）。 */
function renderIconset(into) {
  for (const [size, name] of ICONSET_ENTRIES) {
    const output = join(into, name);
    runCapture('sips', ['-s', 'format', 'png', '--resampleHeightWidth', String(size), String(size), ICON_SOURCE, '--out', output]);
    if (!existsSync(output)) fail(`sips 未产出 ${name}`);
    const actual = pngSize(output);
    if (actual.width !== size || actual.height !== size) {
      fail(`${name} 尺寸不符: 期望 ${size}x${size}，实际 ${actual.width}x${actual.height}`);
    }
  }
}

/** 从 icns 反解 iconset，返回「文件名 → SHA-256」；用于与重渲染结果逐档比对。 */
function extractIconset(icnsPath, into) {
  runCapture('iconutil', ['-c', 'iconset', '-o', into, icnsPath]);
  const digests = {};
  for (const [, name] of ICONSET_ENTRIES) {
    const file = join(into, name);
    if (!existsSync(file)) fail(`icns 缺少分档 ${name}`);
    digests[name] = sha256(file);
  }
  return digests;
}

function compare(freshDir, packedDigests) {
  return ICONSET_ENTRIES.map(([, name]) => name).filter(
    (name) => sha256(join(freshDir, name)) !== packedDigests[name],
  );
}

if (process.platform !== 'darwin') fail('icns 生成依赖 macOS 的 sips / iconutil');
if (!existsSync(ICON_SOURCE)) fail(`品牌图标源缺失: ${ICON_SOURCE}`);

const work = mkdtempSync(join(tmpdir(), 'workdsh-icon-'));
try {
  const fresh = join(work, 'fresh.iconset');
  const packed = join(work, 'packed.iconset');
  renderIconset(fresh);

  if (checkOnly) {
    if (!existsSync(ICNS_TARGET)) fail(`待校验的 icns 不存在: ${ICNS_TARGET}`);
    const mismatch = compare(fresh, extractIconset(ICNS_TARGET, packed));
    if (mismatch.length > 0) fail(`icns 与品牌资产不一致（${mismatch.length}/10 档）:\n  ${mismatch.join('\n  ')}`);
    console.log(`[build-desktop-icon] 一致：10 档全部与 ${ICON_SOURCE} 渲染结果相同`);
  } else {
    runCapture('iconutil', ['-c', 'icns', '-o', ICNS_TARGET, fresh]);
    if (!existsSync(ICNS_TARGET)) fail('iconutil 未产出 icns');
    const mismatch = compare(fresh, extractIconset(ICNS_TARGET, packed));
    if (mismatch.length > 0) fail(`写入后回读不一致:\n  ${mismatch.join('\n  ')}`);
    console.log(`[build-desktop-icon] 已从 ${ICON_SOURCE} 重新生成`);
    console.log(`[build-desktop-icon] 目标 ${ICNS_TARGET}`);
  }
  console.log(`[build-desktop-icon] 10 档回读校验通过`);
  console.log(`[build-desktop-icon] 大小 ${statSync(ICNS_TARGET).size} 字节`);
  console.log(`[build-desktop-icon] SHA-256 ${sha256(ICNS_TARGET)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
