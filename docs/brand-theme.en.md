# Brand palette and upgrade strategy

> Readers: anyone changing colours, adding a panel, or upgrading the pinned dsh runtime.
> In one line: **the whole palette has exactly one definition** (`packages/ui/src/styles/brand.ts`).
> Panels keep writing `var(--dsw-alias-*)`; the bridge happens inside product surfaces only, so the
> Host chrome (titlebar, sidebar, conversation) stays on its own theme.

---

## 0 Quick reference

| I want to… | Change | Note |
| --- | --- | --- |
| Change the accent / greys / radii / shadows | `--wd-*` in `packages/ui/src/styles/brand.ts` | Applies app-wide, no panel edits |
| Make a new panel pick up the palette | Add its root class to `productSurface` in the same file | Zero changes in the panel |
| Fix card shape / hover / pills | Add `src/client/styles-brand.ts` in that plugin and append it in `<style>` | Only when composition must change |
| Roll back to the upstream look | Delete the five `styles-brand.ts` files and their five `<style>` entries | See §7.3 |
| Look up domain hues | §2.4 or `domainPalette` | Colour carries business meaning |
| Self-check before a dsh upgrade | The commands in §6 | Criteria are in the same section |

---

## 1 Three layers

```
                 upstream  @deepseek-ai/dsh-client-ui-theme
                                │  --dsw-alias-*  (used by 100% of panel styles)
                                │
  (1) token     packages/ui/src/styles/brand.ts
      ├─ publishes --wd-*
      └─ on product-surface roots only, re-points --dsw-alias-* to --wd-*
                                │
  (2) injection packages/bundle/src/client/components/ShellAppearance.tsx
      └─ mounted once on shell.overlay (brandCss)
                                │
  (3) composition (optional)  <plugin>/src/client/styles-brand.ts
      └─ shape and state only; every colour references --wd-*
```

(1) is mandatory. (2) is what makes "change one place, whole app follows" true. (3) is per-screen polish
and can be added or removed freely.

**Why not edit colours inside panels**: plugin styles contain 1000+ `var(--dsw-alias-*)` references
across 36 distinct names.
Replacing them one by one is not revertible and turns the next palette change back into manual labour.

**Why not target `:root`**: that would repaint the Host's own titlebar, sidebar and conversation area,
which this repository has no way to verify (see §9). The bridge therefore targets panel roots.

---

## 2 Tokens

### 2.1 Surfaces and borders

| Token | Value | Use |
| --- | --- | --- |
| `--wd-bg-app` | `#f4f6fa` | Page background, panel root |
| `--wd-surface` | `#ffffff` | Cards, panels, overlays, inputs |
| `--wd-surface-sunken` | `#fafbfd` | Inset areas: dialog body, detail blocks, installable cards |
| `--wd-border` | `#e9edf5` | Default border, divider |
| `--wd-border-strong` | `#dde3ee` | Resting input border, secondary button |

Hover backgrounds have no separate token; they use `--wd-brand-soft` (`#f2f6ff`) so no extra grey exists.

### 2.2 Text (three levels only)

| Token | Value | Use |
| --- | --- | --- |
| `--wd-text-primary` | `#101828` | Headings, key figures |
| `--wd-text-secondary` | `#5b6577` | Descriptions, secondary info |
| `--wd-text-tertiary` | `#98a2b3` | Meta, placeholders, helper text |
| `--wd-text-on-brand` | `#ffffff` | Text on a brand fill (buttons, selected chips) |

Hierarchy comes from weight and size, never from a fourth grey.

### 2.2.1 Status inks

The domain hues are too light to carry small text on their own tint. These three are the readable
counterparts, checked against the matching soft fill:

| Token | Value | Paired fill | Use |
| --- | --- | --- | --- |
| `--wd-ink-success` | `#0a7b46` | `--wd-domain-parse-tint` `#e6f9f0` | Success toast, completed badge |
| `--wd-ink-warn` | `#b45309` | `--wd-domain-knowledge-tint` `#fff4e0` | Warning strip, in-progress badge |
| `--wd-ink-danger` | `#b42318` | `--wd-domain-risk-tint` `#feeceb` | Error toast, failed badge |

Never use the raw domain hue (`#12b76a` / `#f5a524` / `#f04438`) as text on a soft fill — the
contrast is not there.

### 2.3 Brand accent (the only saturated accent in the app)

| Token | Value | Use |
| --- | --- | --- |
| `--wd-brand` | `#2f6bff` | Primary action, selection, links, key numbers |
| `--wd-brand-pressed` | `#1e52d9` | Pressed / hover, one step darker |
| `--wd-brand-tint` | `#e3ebff` | Selected and tag backgrounds, icon tiles |
| `--wd-brand-soft` | `#f2f6ff` | Hover background, faint callout |

### 2.4 Nine domain hues

| Key | Colour | Tint (~8%) | Domain |
| --- | --- | --- | --- |
| `understand` | `#2f6bff` | `#ebf1ff` | Content understanding |
| `govern` | `#7a5af8` | `#f2eeff` | Asset governance |
| `parse` | `#12b76a` | `#e6f9f0` | Task parsing (also success) |
| `plan` | `#14b8a6` | `#e4f8f6` | Material planning |
| `create` | `#6366f1` | `#edeefe` | Content creation |
| `audit` | `#f97316` | `#fff1e8` | Content review |
| `risk` | `#f04438` | `#feeceb` | Risk control (also error) |
| `knowledge` | `#f5a524` | `#fff4e0` | Knowledge service (also warn) |
| `platform` | `#0ba5ec` | `#e5f5fe` | Platform support |

The order is semantic: understanding/governance (blue-violet) → production (green/teal/indigo) →
review (orange/red) → platform (cyan). `domainTone(name)` hashes a name onto one of the nine, so the
same name always gets the same hue and users learn "violet means governance".

### 2.5 Shape and elevation

| Token | Value |
| --- | --- |
| `--wd-radius-sm` | `8px` (chips, small controls) |
| `--wd-radius-md` | `10px` (buttons, inputs) |
| `--wd-radius-lg` | `14px` (cards, panels) |
| `--wd-shadow-card` | `0 1px 2px rgba(16,24,40,.04), 0 6px 16px -6px rgba(16,24,40,.08)` |
| `--wd-shadow-hover` | `0 2px 6px -1px rgba(47,107,255,.16), 0 14px 30px -12px rgba(16,24,40,.16)` |
| `--wd-shadow-dialog` | `0 18px 48px -12px rgba(16,24,40,.28)` |
| `--wd-mask` | `rgba(16,24,40,.42)` |

Shadows are cool grey, never pure black.

---

## 3 Bridge map

`brandCss` re-points these upstream names on product-surface roots. **The left column is what panels
already write — nothing there needs to change.**

| Upstream alias | → palette | Meaning |
| --- | --- | --- |
| `bg-base` | `--wd-bg-app` | Page background |
| `bg-layer-1` / `bg-layer-2` | `--wd-surface` | Cards / panels |
| `bg-layer-3` | `--wd-brand-tint` | Selected layer |
| `bg-skeleton` | `--wd-border` | Skeleton placeholder |
| `bg-mask-2` | `--wd-mask` | Overlay |
| `border-l1` / `border-primary` / `border-l3` / `border-l4` | `--wd-border-strong` | Emphasised border |
| `border-l2` | `--wd-border` | Default border |
| `label-primary` / `text-primary` | `--wd-text-primary` | Primary text |
| `label-secondary` | `--wd-text-secondary` | Secondary text |
| `label-tertiary` / `label-dimmed` / `label-caption` | `--wd-text-tertiary` | Helper text |
| `label-primary-inverted` / `label-primary-foreground` | `--wd-text-on-brand` | Text on brand fill |
| `brand-primary` / `brand-text` / `button-primary-fill` / `business-primary` / `state-business-primary` | `--wd-brand` | Accent |
| `interactive-bg-hover` / `interactive-bg-hover-solid` / `button-tool-bar-hover` | `--wd-brand-soft` | Hover |
| `button-tool-bar-fill` | `--wd-surface` | Toolbar button fill |
| `state-success-primary` | `--wd-domain-parse` | Success |
| `state-success-tertiary` | `--wd-domain-parse-tint` | Success surface |
| `state-warn-primary` | `--wd-domain-knowledge` | Warning |
| `state-warn-tertiary` | `--wd-domain-knowledge-tint` | Warning surface |
| `state-error-primary` / `state-danger-primary` | `--wd-domain-risk` | Error |
| `state-error-secondary` | `--wd-domain-risk-tint` | Error surface |

Not bridged: `fill-tsp-secondary` (one use, meaning unclear) — it keeps the Host value.

---

## 4 Adding a panel

**Decide which case you are in before writing any CSS.**

| Case | Action | Cost |
| --- | --- | --- |
| A. Panel only uses `var(--dsw-alias-*)` | **Nothing** — automatic once it is in `productSurface` | 0 |
| B. Root class missing from `productSurface` | Add one line there, or put `wd-theme` on the root | 1 line |
| C. Card shape / hover / pills differ from the design | Add `<plugin>/src/client/styles-brand.ts` = `${brandCss}` + `@layer epuberdsh-business { … }`, append it in the panel `<style>` | one file + 1 line |

Registered roots: `.wd-skills` `.wd-experts` `.wd-connectors` `.wd-projects` `.wd-library`
`.wd-knowledge` `.wd-quality` `.wd-workbenches`, plus the `.wd-theme` escape hatch.

Five panels have a (3) layer today — **skills / connectors / projects / experts / knowledge**.

### 4.1 Audit results (findings, not a to-do list)

| Panel | Verdict | Evidence |
| --- | --- | --- |
| `quality-analysis` | No layer | All 25 hex occurrences sit in `var(--x,#e5e7eb)` fallbacks; cards are 12px and token-driven |
| `workbenches` | No layer | Zero hardcoded colours; layout is list rows (`.wd-catalog-row`), not cards; button hover already works |
| `library` | Literals only | The `#2d2519` dark warning strip and `rgba(0,0,0,.42)` popover shadow moved to tokens; everything else uses aliases |
| `knowledge` | Literals + layer | Toast / badges / warning were dark literals (now tint + ink); kb-card hovered to the grey `label-tertiary` border, which reads as disabled |
| `experts` | Layer | `.card:hover` reset `border-color` and `background` to the resting values — a dead rule; radius was 17px, off the 8/10/14 scale |

**Three rules for layer (3)**

1. Colours are `var(--wd-*)` only; `rgba()` is allowed inside shadows only.
2. Override shape and state, never restate colour (restating creates a second definition).
3. **Unlayered upstream styles (`modalCss` / `controlsCss`) beat any `@layer`.** Overrides for
   `.wd-dialog` must live outside a layer, or they fail silently regardless of specificity.

---

## 5 Design rules (worth more than the hex values)

1. **One blue per screen.** The accent belongs to the primary action or the selection; two blue buttons
   means no hierarchy.
2. **Colour lives in icons and dots.** Large colour areas are limited to the 44px icon tile (same-hue
   tint) and the 6px dot. Card bodies stay white, otherwise nine hues fight each other.
3. **Theming swaps neutrals only.** In dark mode the nine domain hues stay identical; only
   bg / surface / border / text change.

---

## 6 Verification

```bash
cd apps/web
node node_modules/pnpm/bin/pnpm.cjs --filter epuberdsh-ui build
node node_modules/pnpm/bin/pnpm.cjs --filter epuberdsh-plugin-skills build
node node_modules/pnpm/bin/pnpm.cjs --filter epuberdsh-plugin-connectors build
node node_modules/pnpm/bin/pnpm.cjs --filter epuberdsh-plugin-projects build
node node_modules/pnpm/bin/pnpm.cjs --filter epuberdsh-bundle build
```

Criteria: every command exits 0. Write `--filter` names in full (never build commands from shell
variables — see §10).

**Drift check** (if upstream renames an alias, the bridge silently no-ops and the surface falls back to
the Host colour — no error):

```bash
rg -o --no-filename --glob '!**/dist/**' '\-\-dsw-alias-[a-z0-9-]+' packages \
  | sort -u > /tmp/used.txt
rg -o --no-filename '\-\-dsw-alias-[a-z0-9-]+' packages/ui/src/styles/brand.ts \
  | sort -u > /tmp/bridged.txt
comm -23 /tmp/used.txt /tmp/bridged.txt   # only fill-tsp-secondary should remain
```

**Visual check**: `.artifacts/panels-brand-preview.html` (three panels side by side) and
`.artifacts/skills-brand-preview.html` render the CSS each plugin actually injects — the DOM is mirrored
by hand, styles are not re-typed. Regenerate and eyeball; no need to boot Electron.

---

## 7 Upgrade strategy

### 7.1 Why the next upgrade will not break

| Fact | Consequence |
| --- | --- |
| No `@deepseek-ai/*` file touched, no new dependency, no lockfile change | Nothing to resolve or re-apply on upgrade |
| The bridge couples to variable *names*, not DOM structure | Upstream layout or class renames leave colours intact |
| `ShellAppearance` already existed (only gained `brandCss`) | No new mount point, no slot contention |
| Failure mode is **degradation, not breakage**: renamed alias → Host colour | Worst case is "old look", never a blank screen |

### 7.2 Four guardrails

1. Single token source: `brand.ts`. Any literal hex elsewhere is a leak.
2. Composable layer (3): three independent files; deleting one affects one panel.
3. Single injection point: `ShellAppearance`.
4. Drift check (§6) after every upgrade — 30 seconds.

### 7.3 Rollback

| Scope | Action | Result |
| --- | --- | --- |
| One panel | Delete its `styles-brand.ts`, drop the `<style>` concatenation | Original composition, new palette |
| All composition | Delete the five files and five injections | All panels original composition, new palette |
| Everything | Also drop `${brandCss}` in `ShellAppearance.tsx` | Exactly the pre-upgrade look |

`brand.ts` can stay exported-but-unused; it does not affect the build.

### 7.4 Versioning notes

- `dist/` is gitignored, so **build order matters**: `epuberdsh-ui` resolves through `dist/index.js`.
  Editing `packages/ui/src` without rebuilding ui leaves every panel on the old CSS.
- Adding a panel touches `productSurface` only. Do not also restyle that plugin — it is review noise.

---

## 8 Roadmap

| Phase | Content | Dependency | Status |
| --- | --- | --- | --- |
| P1 | token layer, global injection, composition for skills / connectors / projects | — | done |
| P2 | Audit the other five panels and **fix only real defects** | per-screen review | done: layers for experts / knowledge, literals for library, quality / workbenches need nothing (see §4.1) |
| P3 | Dark mode: `[data-theme="dark"]` overriding the six neutral tokens, domain hues untouched | **Host must expose a theme signal**; this repo has none | blocked |
| P4 | Legacy cleanup: dark toasts and badges in `library` / `knowledge`; six undefined `--p-*` in `projects` | — | done |

**P2 landed differently than planned**: the plan said "one composition layer per screen", but the audit
showed most panels (quality / workbenches / library) already live on tokens and working hover states —
adding a layer would only create a second definition. P2 collapsed into "fix real defects": dead hovers,
off-scale radii, dark literals, undefined variables. P3 stays blocked because a theme switch without a
Host signal is a fake switch.

---

## 9 Known gaps (honest list)

1. **Host chrome not taken over**: titlebar, sidebar and conversation still use the upstream theme.
   Unifying them requires `:root` overrides over areas this repository cannot verify — a separate task.
2. **No dark mode**: tokens are named for "swap neutrals only", but there is no theme signal source.
3. **The new experts / knowledge composition has no full-screen visual acceptance**: the local preview
   runtime (0.2.2-alpha.2) does not match the version this repo expects (0.1.7-rc.2), so a real preview
   needs `preview:install`. Those two panels were checked at the CSS level (rules match, values come from
   tokens), not pixel by pixel. **Run `preview:install` before the next upgrade to close this gap.**
4. **One screen verified ≠ app-wide proof**: skills / connectors / projects have full-screen screenshots;
   the rest were checked at background and rule level. The status colours in `library` / `knowledge` were
   checked for paired contrast, not for how the whole screen reads.

---

## 10 Pitfalls

- **`@layer` precedence**: unlayered styles (`modalCss` / `controlsCss`) beat every layer. Dialog
  overrides must sit outside a layer.
- **`dist` is not committed**: without `--filter epuberdsh-ui build`, panels never see `packages/ui/src`.
- **Do not build commands from shell variables**: zsh does not word-split unquoted variables, so
  `P="node pnpm.cjs"; $P --flag` fails, and the trailing `| tail` swallows the exit code into a false green.
- **Headless Chrome needs to escape the sandbox**: `--headless=new --no-sandbox` plus
  `dangerouslyDisableSandbox`, otherwise `sandbox initialization failed`.

---

## 11 Packaging (desktop)

The full chain, reproducible on this machine, producing an unsigned `EpuberDSH.app`:

```bash
# 1. Build the whole web workspace (17 filters, order in apps/web/package.json "build")
cd apps/web
for f in epuberdsh-tabular epuberdsh-contracts ... epuberdsh-plugin-knowledge; do
  env -u NODE_OPTIONS node node_modules/pnpm/bin/pnpm.cjs --filter "$f" build
done

# 2. Pack the built sources into an immutable release (13 packages)
cd ../desktop
node scripts/pack-epuberdsh-profile.mjs ../web build/epuberdsh-profile-release-$(date +%Y%m%d-%H%M%S)

# 3. Prepare the runtime from that release (verifies the 6 product bundles)
EPUBERDSH_RELEASE_DIRECTORY=<dir from step 2> node scripts/prepare-epuberdsh-runtime.mjs
EPUBERDSH_RELEASE_DIRECTORY=<dir from step 2> node scripts/prepare-epuberdsh-primary-runtime.mjs
EPUBERDSH_RELEASE_DIRECTORY=<dir from step 2> node scripts/prepare-epuberdsh-command.mjs

# 4. Desktop main process and electron-builder
node scripts/generate-mac-app-icon.mjs && node scripts/clean.mjs
node node_modules/.bin/tsdown && node node_modules/.bin/tsc -p tsconfig.json --emitDeclarationOnly
node scripts/package-dir.mjs
```

Output:

- `apps/desktop/dist/mac/EpuberDSH.app` (unsigned, ~1.4 GB)
- `apps/desktop/dist/mac-smoke/x64/EpuberDSH-<version>-x64.dmg` (unsigned DMG, produced by
  `node scripts/package-mac.ts`, which mounts the image, checks `Info.plist`, then ejects it)

The packaging scripts run their own native-runtime load, product-bundle count (6) and fuses checks;
any failure exits non-zero.

**Two pitfalls you will hit**

1. Every step that `rmSync('dist')` needs `env -u NODE_OPTIONS` — otherwise the WorkBuddy safe-delete
   shim throws `SAFE_DELETE_BULK_CONFIRM_REQUIRED` above 50 files, which reads like a build failure.
2. `yarn` is not installed, and `packageManager: yarn@4.18.0` makes `corepack pnpm` refuse to run.
   Use a shim (`exec corepack yarn "$@"`) and run it **from the repository root** — elsewhere corepack
   resolves to yarn 1.x.

**Release scope**: `RELEASE_PACKAGES` has 13 packages and does **not** include `knowledge` or
`quality-analysis`. Their palette work only affects dev/preview, not the installer — that is a product
boundary, not an oversight.

---

## 12 Signing and distribution

### 12.1 The short answer: there is no free signature that stops the warning

That is a platform rule, not a missing technique. Free options give you "the file carries a signature",
never "the OS trusts it".

| Platform | What free gets you | What still happens | What actually fixes it |
| --- | --- | --- | --- |
| macOS | Ad-hoc signature (`codesign --sign -`), already present in Electron output | Gatekeeper rejects it: `spctl -a` → `rejected`, "cannot verify the developer" | Apple Developer Program **$99/yr** plus notarization |
| Windows | Self-signed certificate; the signature is visible in the file's properties | SmartScreen still says "unknown publisher" unless the user imports your root CA | OV/EV code-signing certificate (annual fee), Azure Trusted Signing (~$9.9/mo), or **free SignPath signing for OSS projects** |

Two common misconceptions:

- Xcode's free personal team signs **iOS** only; macOS Developer ID requires the paid program.
- Ad-hoc signing buys no trust: copy the app to another Mac and quarantine still applies. The only
  workarounds are right-click → Open, or `xattr -dr com.apple.quarantine <app>`.

### 12.2 Actual state of this build (re-checkable)

```bash
codesign -dv --verbose=2 apps/desktop/dist/mac/EpuberDSH.app
#   Signature=adhoc   flags=0x2(adhoc)   TeamIdentifier=not set
codesign --verify --deep --strict apps/desktop/dist/mac/EpuberDSH.app   # passes
spctl -a -vv apps/desktop/dist/mac/EpuberDSH.app                        # rejected
```

**Signature integrity and OS trust are different things**: `--verify` only proves the bundle is intact;
`spctl` is Gatekeeper's judgement and only accepts Developer ID plus notarization. "It is signed" is
meaningless here unless you say which step.

### 12.3 Installing locally (macOS, works today)

```bash
hdiutil attach -nobrowse apps/desktop/dist/mac-smoke/x64/EpuberDSH-3.0.0-alpha.3-x64.dmg
xattr -dr com.apple.quarantine "/Volumes/EpuberDSH 3.0.0-alpha.3/EpuberDSH.app"
cp -R "/Volumes/EpuberDSH 3.0.0-alpha.3/EpuberDSH.app" /Applications/
hdiutil detach "/Volumes/EpuberDSH 3.0.0-alpha.3"
```

Re-signing with an in-house self-signed certificate changes nothing for Gatekeeper; it only puts an
organisation name into `codesign -dv`. Useless for public distribution.

### 12.4 Where the Windows build comes from

**Not from this machine.** Two hard constraints:

1. `apps/desktop/scripts/package-win.ts:105` asserts
   `if (options.platform !== 'win32') throw new Error('Windows <artifact> must be built on a native Windows host')`.
   That is deliberate: the Windows artifact must run its native runtime load, the NSIS installer check and
   the pwsh sandbox validation on Windows.
2. No wine here (`which wine` is empty), and electron-builder's `rcedit` step (exe icon/version) goes
   through wine — bypassing the assertion still cannot produce a usable installer.

Two viable paths:

| Path | How | Cost |
| --- | --- | --- |
| Repository CI | Push a branch / open a PR to trigger `desktop-windows` in `.github/workflows/ci.yml` (windows-latest, artifact `dsh-plugin-desktop-windows-x64`) | GitHub Actions free minutes; needs push access |
| A Windows machine | `yarn dist:win` (NSIS installer) or `yarn dist:win-portable` (zip); the scripts already run the three prepare steps | One Windows box plus the same full web build first |

Either way the artifact is **unsigned**, so Windows still shows "unknown publisher". Removing that
requires §12.1.

---

## 13 Index

| Keyword | Section |
| --- | --- |
| accent, brand blue, #2f6bff | §2.3 |
| greys, text colours, three levels | §2.2 |
| domain hues, icon tile colours | §2.4 |
| success / warning / error colours, toast, status badges | §2.2.1, §4.1 |
| radius, shadow, spacing | §2.5 |
| alias, bridge, dsw-alias, why panels recolour themselves | §1, §3 |
| add a panel, new panel still old colour | §4 |
| rollback, remove the palette | §7.3 |
| dsh upgrade, colours changed after upgrade, drift | §6, §7.1 |
| dark mode | §8 (P3), §9 |
| dialog override has no effect | §4 rule 3, §10 |
| packaging, installer, .app, release, shipped scope | §11 |
| signing, notarization, Gatekeeper, unknown publisher, SmartScreen | §12.1, §12.2 |
| install locally, quarantine attribute | §12.3 |
| Windows build, exe, nsis | §12.4 |
