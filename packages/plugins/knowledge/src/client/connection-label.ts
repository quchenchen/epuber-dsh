/**
 * Connection facts are produced by the Host, and its vocabulary is English and
 * internal: `ctx.credentials.describe()` answers with a provider layer id such
 * as `file` or `user-env`, and that id used to land in the panel verbatim, so a
 * status line read "凭据已配置（file）". A layer id is not a feature name; it
 * belongs in a log, not in a settings hint.
 *
 * The local provider layers are `file` ($DSH_HOME/.credentials.yaml, the one
 * this product writes), `env`, `user-env` and `project-env`. Anything else is
 * a source this panel cannot explain, so it collapses to the service itself
 * rather than showing a raw token the reader has no way to interpret.
 */
const sourceLabels: Readonly<Record<string, string>> = {
  file: '本机凭据文件',
  env: '环境变量',
  'user-env': '用户环境变量',
  'project-env': '项目环境变量',
};

/** Human label for one credential source id. */
export function credentialSourceLabel(source: string | undefined): string {
  if (!source) return '凭据服务';
  return sourceLabels[source] ?? '凭据服务';
}

/**
 * `http://127.0.0.1:18081/` → `127.0.0.1:18081`. The sidebar is 300px wide and
 * the protocol tells the reader nothing; the full address stays in the tooltip
 * and on the settings page.
 */
export function connectionHostLabel(baseUrl: string | undefined): string {
  const value = baseUrl?.trim();
  if (!value) return '未设置服务地址';
  return value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '') || value;
}
