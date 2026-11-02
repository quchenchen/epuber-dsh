# WorkDSH Web repository rules

This independent pnpm workspace owns WorkDSH feature packages and Web composition inside the combined Desktop repository. Use Node.js `^22.19.0 || >=24.0.0` and Corepack `pnpm@10.34.5`. The Desktop carrier uses the root Yarn workspace; never merge the package-manager graphs.

## Runtime and ownership

- Pin official DSH dependencies and required peers to the product target `0.2.2-alpha.2`, with the Cordis generation that alpha.2 itself declares as peers (`@deepseek-ai/cordis` 4.0.6-alpha.1 plus matching `cordis-plugin-*`). A pin below an official package's peer range makes pnpm materialise one copy per peer set, which splits module-local registries such as `dsh-app-boot` and `dsh-scope`. `preview:install` applies the same official pins to the preview Profile for the same reason. Web consumes published official packages. Never require its checkout for a Web build. The explicit Web-preview and Desktop exception in root AGENTS.md permits only the shared checksum-locked alpha.2 two-seam outer native workbench frame patch; other upstream edits remain prohibited.
- Personal Web, enterprise Web and Desktop share official runtime targets, owned feature packages, business services and pages. Identity, storage, execution and synchronization vary only at explicit adapter boundaries.
- Use official Loader/Profile/Cordis, Session/Agent loop, preset registry, Skill parser/provider, MCP transport, model routing, Remote, Storage and Conversation UI. Do not introduce another Host, Client, loader or executor.
- Feature packages own business objects, revisions, authorization and presentation. Page actions and Agent tools use the same business services. Optional cross-plugin collaboration uses public contracts and lifecycle injection, never another plugin's internal implementation.
- Official Agent Teams owns expert-team execution, messaging and task runtime. Do not restore retired WorkDSH expert-team executors, shared multi-member Host implementations, runtimeToken or onboarding prototypes.

## Feature and delivery contracts

Read [requirements](docs/REQUIREMENTS.md), [architecture](docs/ARCHITECTURE.md) and the affected package README. Ownership and adapter changes follow [the feature development contract](docs/FEATURE-DEVELOPMENT-CONTRACT.md). Public interfaces follow [contracts](docs/CONTRACTS.md) and [the official extension standard](docs/HARNESS-OFFICIAL-DEVELOPMENT.md).

- Experts, library, knowledge, skills, MCP/connectors, projects and the workbench platform are the built-in Desktop feature plugins. This does not install every expert, Skill, server definition or business application.
- The Web preview installs the shared feature set from `profiles/shared/workdsh-features.json`; a plugin package that is built but absent from that list never reaches the Profile and its nav entry renders without a host route. `install-preview.mjs` asserts the composed ids, so add a new feature to the list and to that assertion together.
- Enterprise identity and collaboration are external plugins installed explicitly through the Enterprise Connection archive. They are excluded from the base installer and inactive in personal mode. Installation does not grant membership; enterprise admission and authorization remain server-verified.
- Collaboration, notifications and business applications remain external plugins with independent installation and updates. Other feature delivery follows [plugin delivery](docs/PLUGIN-DELIVERY.md) and [external plugins](docs/EXTERNAL-PLUGINS.md).
- A Profile selects configuration/plugins; it is not an account or security boundary. Enterprise member admission, data ownership, credentials, files and actual operations require server-side authorization.
- Keep one implementation and one state owner. Enterprise account composition removes personal identity, uses the actual member's credentials, and keeps account storage separate. Never package passwords, internal model keys or server service keys.
- SkillHub and dsh-market are third-party discovery sources. Browsing does not imply automatic installation, compatibility validation or approval of every directory entry.
- Preview and Desktop take their community catalog pins from one inventory (`CATALOG_PACKAGES` in `apps/desktop/scripts/workdsh-package-boundary.mjs`). Installing a catalog package is not enough: its bundle must also be listed in `dsh.profile.bundles`, otherwise its HTTP routes are absent while the panel still renders and the client reports an empty response instead of a real error.

## Implementation and lifecycle

- Plugins live at `packages/plugins/<domain>` and providers at `packages/providers/<name>`. Parent directories only categorize packages. Register new modules in `docs/modules.json`; keep planned scaffolds free of loadable DSH/package entry points or fake responses.
- Use official declared Slots and their owner props. Keep native Session/Workspace/Settings owners. Register lifecycle effects through `ctx.effect`, `ctx.on`, `ctx.slots.inject` or official managed APIs, and verify disposal.
- Published object revisions are immutable. File imports create explicit copies; uncertain external writes require result reconciliation and idempotent retry. A model's completion message cannot replace an actual receipt.
- Credentials stay outside prompts, browser state, logs, exports and source. UI filtering or plugin scope cannot replace identity and operation authorization.
- Maintain built-in Skill text in packaged `SKILL.md` and Markdown resources. TypeScript registers or generates from that source; do not keep a second prompt copy or rely on developer paths.
- Word delivery has one layout owner: `packages/plugins/office/src/live/material-format.ts` drives the DOCX writer's page setup, default east-asian fonts, heading levels and footer page numbers for every expert, Skill and `content_export` call. Change the constants there instead of adding per-Skill font sizes, and keep `packages/plugins/skills/resources/skills/word-design/references/material-format.md` in sync because that table is what the model reads.
- A Skill identity stays ASCII kebab-case because the official runtime only loads that grammar (`isSkillName`); Chinese or other display text belongs in the frontmatter `title` (also accepted: `displayName`/`display-name`, or a non-ASCII `name` that repair migrates). `repairIdentity` is the only writer for third-party packs — it derives the identity from `name`/`slug`/directory, keeps the original label as `title`, and closes a missing frontmatter fence; never rewrite imported skills silently outside that action.
- Use isolated synthetic Homes for automated tests. Graphical launches and paid model/external-service probes remain explicit.

## Checks and public documentation

Run `corepack pnpm install --frozen-lockfile`, `build`, `typecheck`, `check:versions`, `check:plan`, `test:planning` and relevant integration/package tests. Enterprise changes additionally build/typecheck the identity and collaboration packages and run their tests plus `deploy/member-process/tests`.

`docs/` publishes only the finite requirements, contracts, architecture, module registry and acceptance specifications allowed by `.gitignore`. Development diaries, STATUS/PLAN ledgers, historical evidence and generated outputs remain local. [Acceptance](docs/ACCEPTANCE.md) distinguishes required scenarios from actual verified results; ignored `.artifacts` can hold local test evidence. Do not claim installed runtime, GUI or deployment acceptance from source checks alone.

Preserve existing worktree changes. User authorization controls commits, pushes, publication and external actions; do not send messages to other people without explicit authorization.
