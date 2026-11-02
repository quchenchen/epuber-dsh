/**
 * Single source of truth for the packaged application name.
 *
 * Electron Builder derives the `.app` bundle directory, the macOS executable
 * inside it, the Windows executable and the installer artifact name from
 * `build.productName`. Verification and acceptance scripts must read it from
 * the manifest instead of repeating a literal, otherwise a product rename
 * silently turns every gate into a false failure.
 */
import { readFileSync } from 'node:fs'

/** @type {{ name?: string, build?: { productName?: string } }} */
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const productName = manifest.build?.productName ?? manifest.name
if (typeof productName !== 'string' || productName.length === 0) {
  throw new Error('desktop package.json has no usable build.productName')
}

/** Packaged application name, without any file extension. */
export const PRODUCT_NAME = productName
