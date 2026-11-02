import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

// Fixtures must declare the generation this SDK actually supports; a literal
// here silently rots on every Host upgrade.
const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
export const cordisRange = manifest.peerDependencies['@deepseek-ai/cordis'];
export const installedCordis = JSON.parse(
  await readFile(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'), 'utf8'),
).version;
