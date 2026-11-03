import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Build the browser client bundle for the knowledge plugin.
 *
 * The EpuberDSH web shell loads plugin clients through `window.__ModuleLoader__`,
 * so the bundle is CommonJS wrapped in that loader call. Official client
 * packages and React stay external: the shell provides them.
 */
const entry = new URL('../../../packages/plugins/knowledge/', import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', entry))],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'],
});
await writeFile(
  new URL('dist/client.browser.js', entry),
  `window.__ModuleLoader__.load({id: "epuberdsh-plugin-knowledge", factory: function(require) { const module = {exports:{}};\n${result.outputFiles[0].text}\nreturn module.exports; }});\n`,
);
console.log('Knowledge client bundle: dist/client.browser.js');
