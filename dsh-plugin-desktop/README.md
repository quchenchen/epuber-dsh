# WorkDSH Desktop carrier

[中文](README.zh.md)

This package builds the Electron application. The installer contains `lib/workdsh-main.js` and one bundled runtime Profile. DeepSeek Harness Host, Web Client, and core capabilities come from the pinned upstream release in that Profile. WorkDSH projects, library, experts, skills, connectors, and their supporting services are composed by `workdsh-bundle`; they are not separate desktop editions.

## Brand assets

The application and tray icons are **generated, never hand-placed binaries**:

| Output | Source | Generator |
| --- | --- | --- |
| `build/app-icon.png` | `workdsh-web/assets/brand/ai-rongmei-icon.svg` | `scripts/generate-brand-app-icon.mjs` |
| `build/app-icon.ico` | `build/app-icon.png` | `scripts/generate-windows-app-icon.mjs` |
| `build/app-icon-mac.png` | `build/app-icon.png` | `scripts/generate-mac-app-icon.mjs` |
| `build/tray-icon.svg` | `workdsh-web/scripts/build-brand-assets.mjs` | written by that script |
| `build/tray-icon*.png` | `build/tray-icon.svg` | `scripts/generate-tray-icons.mjs` |

Geometry, colours and naming have exactly one source: `workdsh-web/scripts/build-brand-assets.mjs`, which also emits the machine-readable `workdsh-web/assets/brand/brand.json`. The generators above read the accent colour from that file, so this package does not hardcode brand colours. `yarn build` regenerates everything in the order listed. To detect drift between the two workspaces, run `node workdsh-web/scripts/check-brand-consistency.mjs`; to change the logo, edit that script and regenerate — never edit a `build/*.png` by hand.

## Development

Use Node.js `^22.19.0` or `>=24` and Corepack Yarn 4.18.0. At the repository root:

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

`dev` builds the carrier, prepares the pinned Profile and primary runtime, then launches Electron. It is the only command here that starts a graphical application. For headless verification use `corepack yarn check` and `corepack yarn check:desktop-dsh-alignment`. `corepack yarn workspace dsh-plugin-desktop package:dir` creates an unpacked application and checks that it contains no duplicate DSH dependency tree.

The upstream checkout is read-only from this package. When upgrading DSH, update the submodule pin and runtime preparation version together, then validate the WorkDSH Profile, both platform package checks, and the resulting installers before publishing. Prefer the latest official stable DSH release; pre-releases require an explicit product decision.

The carrier sources and package scripts live in this directory. The Profile package source and its release are owned by the WorkDSH repository; see [Desktop ownership](../docs/desktop-boundaries.md).
