/** Derive the cross-platform 1024px application icon from the shared brand master. */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Pixel width and height of the canonical cross-platform icon canvas. */
export const BRAND_APP_ICON_CANVAS = 1024

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const brandRoot = join(packageRoot, '..', 'workdsh-web', 'assets', 'brand')
const sourcePath = join(brandRoot, 'ai-rongmei-icon.svg')
const outputPath = join(packageRoot, 'build', 'app-icon.png')

/**
 * 把 SVG 的默认渲染尺寸改成目标画布尺寸。
 *
 * 必须在渲染前改：`ai-rongmei-icon.svg` 自带 `width="512"`，若让它先渲 512 再
 * resize 到 1024，得到的是位图插值放大（糊）。改 width/height 后由 sharp 直接
 * 在目标分辨率上栅格化矢量，是真正的矢量渲染。
 * @param {string} svg - 源 SVG 文本。
 * @param {number} size - 目标画布边长。
 * @returns {string} 已改写渲染尺寸的 SVG。
 */
function atCanvas(svg, size) {
  if (/\swidth="[^"]*"\sheight="[^"]*"/u.test(svg)) {
    return svg.replace(/\swidth="[^"]*"\sheight="[^"]*"/u, ` width="${size}" height="${size}"`)
  }
  return svg.replace(/<svg\b/u, `<svg width="${size}" height="${size}"`)
}

/**
 * 从品牌主图生成跨平台应用图标母版 `build/app-icon.png`。
 *
 * 为什么需要这一步：`app-icon.png` 是 `generate-windows-app-icon.mjs` 与
 * `generate-mac-app-icon.mjs` 的共同输入，但它在历史上是一张**手工放入的二进制**
 * （亮蓝 W 波浪），没有生成路径——想换图标只能重新手工做一张符合
 * `1024x1024 / rgb16 / 16bit / 4ch / 带 ICC` 严格规格的 PNG。本脚本把它
 * 变成可重跑产物，源是 web workspace 的品牌主图。
 *
 * 输出规格由下游两个生成器的前置断言决定，不能放宽：
 * 1024x1024、rgb16/ushort/16bit、4 通道、带 alpha、带 ICC profile。
 *
 * @param {string} source - 品牌主图 SVG 的绝对路径。
 * @param {string} output - 生成的 PNG 绝对路径。
 * @returns {Promise<void>} 完整 PNG 写入后 resolve。
 */
export async function generateBrandAppIcon(source = sourcePath, output = outputPath) {
  if (resolve(source) === resolve(output)) {
    throw new Error('generate-brand-app-icon: output must not overwrite the source artwork')
  }

  const svg = await readFile(source, 'utf8')
  const rendered = await sharp(Buffer.from(atCanvas(svg, BRAND_APP_ICON_CANVAS)), { density: 72 })
    .resize({ width: BRAND_APP_ICON_CANVAS, height: BRAND_APP_ICON_CANVAS, fit: 'fill' })
    .toColourspace('rgb16')
    .withIccProfile('srgb')
    .png({
      compressionLevel: 9,
      progressive: false,
      adaptiveFiltering: false,
      palette: false,
    })
    .toBuffer()

  const generated = await sharp(rendered).metadata()
  if (
    generated.format !== 'png'
    || generated.width !== BRAND_APP_ICON_CANVAS
    || generated.height !== BRAND_APP_ICON_CANVAS
    || generated.space !== 'rgb16'
    || generated.depth !== 'ushort'
    || generated.bitsPerSample !== 16
    || generated.channels !== 4
    || generated.hasAlpha !== true
    || generated.icc === undefined
  ) {
    throw new Error(
      `generate-brand-app-icon: output must be a ${BRAND_APP_ICON_CANVAS}x${BRAND_APP_ICON_CANVAS} RGBA16 PNG with an ICC profile`,
    )
  }

  await writeFile(output, rendered)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateBrandAppIcon()
}
