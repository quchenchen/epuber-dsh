/** Generate native tray bitmaps from the shared brand source owned by the web workspace. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath, 'utf8')

/**
 * 品牌真源由 web workspace 拥有：`workdsh-web/assets/brand/brand.json`，
 * 生成者是 `workdsh-web/scripts/build-brand-assets.mjs`。
 *
 * 这里**只读不写**。本包对外发布的是 `build/` 下已生成的 PNG，本生成器只在开发期
 * （`yarn build`）运行，所以跨目录读真源不构成运行时依赖，也不改变
 * AGENTS.md 规定的两个 workspace 之间的包管理边界。好处是色值只有一份：
 * 历史上桌面这里硬编码 #176BFF/#18CFE7，与 web 的品牌色长期漂移。
 */
const brand = JSON.parse(
  await readFile(join(packageRoot, '..', 'workdsh-web', 'assets', 'brand', 'brand.json'), 'utf8'),
)
/** 托盘强调色，与 web 品牌同一色值。 */
const BRAND_ACCENT = brand.desktop.trayAccent
if (!(source.includes(`fill="${BRAND_ACCENT}"`) || source.includes(`stroke="${BRAND_ACCENT}"`))) {
  throw new Error(`generate-tray-icons: tray-icon.svg must use the shared brand accent ${BRAND_ACCENT}`)
}
if (/<style\b/iu.test(source)) {
  throw new Error('generate-tray-icons: tray-icon.svg must not rely on a <style> block')
}

const variants = [
  ['tray-iconTemplate.png', '#000000', 16],
  ['tray-iconTemplate@2x.png', '#000000', 32],
  ['tray-icon-blue.png', BRAND_ACCENT, 16],
  ['tray-icon-blue@1.25x.png', BRAND_ACCENT, 20],
  ['tray-icon-blue@1.5x.png', BRAND_ACCENT, 24],
  ['tray-icon-blue@2x.png', BRAND_ACCENT, 32],
]

await Promise.all(variants.map(async ([filename, color, size]) => {
  const rendered = source.replaceAll(BRAND_ACCENT, color)
  await sharp(Buffer.from(rendered))
    .resize({ width: size, height: size, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
