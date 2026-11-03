// Review this inventory when the EpuberDSH release adds or removes a package.
// Only product packages are selected or exposed by the default personal Profile.
export const PRODUCT_PACKAGES = Object.freeze([
  'epuberdsh-plugin-connectors',
  'epuberdsh-plugin-experts',
  'epuberdsh-plugin-knowledge',
  'epuberdsh-plugin-library',
  'epuberdsh-plugin-projects',
  'epuberdsh-plugin-skills',
  'epuberdsh-plugin-workbenches',
])

// External enterprise packages: installed explicitly, never included in the base installer.
export const ENTERPRISE_PACKAGES = Object.freeze([
  'epuberdsh-provider-identity-enterprise',
  'epuberdsh-plugin-enterprise-collaboration',
  'epuberdsh-enterprise-connection',
])

// Keep the already shipped community catalog integrations on the same Profile.
export const CATALOG_PACKAGES = Object.freeze({
  '@cocofhu/skillhub': '0.2.16',
  dshmarket: '1.66.8',
})

export const RELEASE_PACKAGES = Object.freeze([
  'epuberdsh-contracts',
  'epuberdsh-ui',
  'epuberdsh-provider-identity-local',
  'epuberdsh-provider-browser-session',
  'epuberdsh-plugin-audit',
  'epuberdsh-plugin-access',
  'epuberdsh-plugin-skills',
  'epuberdsh-plugin-experts',
  'epuberdsh-plugin-knowledge',
  'epuberdsh-plugin-connectors',
  'epuberdsh-plugin-library',
  'epuberdsh-bundle',
  'epuberdsh-plugin-projects',
  'epuberdsh-plugin-workbenches',
])

export const PACKAGE_DIRECTORIES = Object.freeze({
  'epuberdsh-contracts': '../../packages/contracts',
  'epuberdsh-ui': '../../packages/ui',
  'epuberdsh-provider-identity-local': '../../packages/providers/identity-local',
  'epuberdsh-provider-browser-session': '../../packages/providers/browser-session',
  'epuberdsh-plugin-audit': '../../packages/plugins/audit',
  'epuberdsh-plugin-access': '../../packages/plugins/access',
  'epuberdsh-plugin-skills': '../../packages/plugins/skills',
  'epuberdsh-plugin-experts': '../../packages/plugins/experts',
  'epuberdsh-plugin-knowledge': '../../packages/plugins/knowledge',
  'epuberdsh-plugin-connectors': '../../packages/plugins/connectors',
  'epuberdsh-plugin-library': '../../packages/plugins/library',
  'epuberdsh-bundle': '../../packages/bundle',
  'epuberdsh-plugin-projects': '../../packages/plugins/projects',
  'epuberdsh-plugin-workbenches': '../../packages/plugins/workbenches',
  'epuberdsh-provider-identity-enterprise': '../../packages/providers/identity-enterprise',
  'epuberdsh-plugin-enterprise-collaboration': '../../packages/plugins/enterprise-collaboration',
})
