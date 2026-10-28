import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

/**
 * Acceptance for organization-scoped knowledge connection settings.
 *
 * The interesting property is not the form: it is that the row belongs to the
 * organization, so a write by an administrator is what every member reads, and
 * that a member cannot write at all. The role gate is proven in
 * packages/plugins/knowledge/tests/settings.test.mjs, because this profile's
 * identity is always `owner`; here we assert what the owner actually sees and
 * that the write round-trips.
 *
 * Usage:
 *   node scripts/verify-knowledge-settings.mjs "<login-url-with-token>"
 */
const login = process.argv[2];
if (!login) throw new Error('usage: node scripts/verify-knowledge-settings.mjs <login-url-with-token>');
const shots = fileURLToPath(new URL('../../../.artifacts/knowledge-plugin/', import.meta.url));
await mkdir(shots, { recursive: true });

const report = { checks: [], shots: [] };
const check = (name, condition, detail = '') => {
  if (!condition) throw new Error(`FAILED: ${name}${detail ? ` (${detail})` : ''}`);
  report.checks.push(name);
  console.log(`PASS ${name}`);
};

const rpc = (page, endpoint, payload = {}) => page.evaluate(async ({ endpoint, payload }) => {
  const response = await fetch('/api/workdsh-knowledge', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }),
  });
  return { status: response.status, body: await response.json() };
}, { endpoint, payload });

const dismissSetup = async page => {
  for (const name of ['Continue', '继续', 'Configure later', '稍后配置']) {
    await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 2500 })
      .then(() => page.getByRole('button', { name, exact: true }).click()).catch(() => undefined);
  }
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(login, { waitUntil: 'domcontentloaded' });
  await dismissSetup(page);

  const before = await rpc(page, 'settings');
  check('连接设置可读', before.status === 200 && before.body.ok, JSON.stringify(before.body).slice(0, 200));
  const original = before.body.value;
  check('设置归属组织', original.scope === 'organization', String(original.scope));
  check('所有者可编辑', original.canEdit === true && original.role === 'owner', `${original.role}/${original.canEdit}`);
  console.log(`   baseUrl=${original.baseUrl} defaultKbId=${original.defaultKbId ?? '(未设置)'} key=${original.apiKeyConfigured ? original.apiKeySource : '未配置'}`);

  const kbs = await rpc(page, 'list-kbs');
  const energy = (kbs.body.value ?? []).find(kb => kb.name?.includes('能源知识库'));
  check('真实知识库可列举', Boolean(energy), `got ${(kbs.body.value ?? []).length}`);

  // Point the shared default at a real base, then put it back: the round trip
  // is what proves the write reached the organization row.
  const savePrimary = await rpc(page, 'update-settings', { defaultKbId: energy.id });
  check('保存组织级设置成功', savePrimary.status === 200 && savePrimary.body.ok, JSON.stringify(savePrimary.body).slice(0, 200));
  check('写入记录作者', savePrimary.body.value?.updatedBy?.length > 0, String(savePrimary.body.value?.updatedBy));

  const after = await rpc(page, 'settings');
  check('读回同一份配置', after.body.value?.defaultKbId === energy.id, String(after.body.value?.defaultKbId));
  check('成员读到的角色仍是自己的', after.body.value?.role === 'owner', String(after.body.value?.role));

  // Open the panel's settings view and assert the copy explains the scope.
  await page.getByText(/知识库/, { exact: false }).first().click({ timeout: 30_000 }).catch(() => undefined);
  const settingsNav = page.locator('[data-testid="nav-settings"]').first();
  await expect(settingsNav).toBeVisible({ timeout: 30_000 });
  await settingsNav.click();
  const toolbar = page.locator('text=组织级配置，全体成员共用一套');
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  check('设置页说明组织级共享', true);

  const baseUrlInput = page.locator('[data-testid="settings-base-url"]').first();
  await expect(baseUrlInput).toBeVisible({ timeout: 10_000 });
  check('所有者可编辑地址', await baseUrlInput.isEditable());
  const readOnlyBanner = page.locator('[data-testid="settings-readonly"]');
  check('所有者不显示只读提示', (await readOnlyBanner.count()) === 0);
  await page.screenshot({ path: `${shots}30-settings-org.png`, fullPage: true });
  report.shots.push(`${shots}30-settings-org.png`);

  // Restore whatever the profile had before this run.
  await rpc(page, 'update-settings', { defaultKbId: original.defaultKbId ?? null });
  const restored = await rpc(page, 'settings');
  check('已恢复原有默认知识库', (restored.body.value?.defaultKbId ?? null) === (original.defaultKbId ?? null), String(restored.body.value?.defaultKbId));

  check('页面无脚本错误', errors.length === 0, errors.join(' | '));
  await writeFile(`${shots}knowledge-settings.json`, `${JSON.stringify({ ...report, before: {
    baseUrl: original.baseUrl, defaultKbId: original.defaultKbId ?? null, scope: original.scope, role: original.role,
  } }, null, 2)}\n`);
  console.log(`SETTINGS OK · ${report.checks.length} checks · ${shots}knowledge-settings.json`);
} finally {
  await browser.close();
}
