# Mutsu OS development tracker

**Status as of October 23, 2026:** Bootc/Bazzite image integration, branding assets, first-run wizard, Mutsu Search launcher, and a disabled-by-default Adaptive Desktop extension prototype are present in source. **A verified, installed, user-ready Mutsu OS alpha is not yet established.** Image build, boot, installer, and hardware checks still require CI/VM evidence.

This is the canonical **release roadmap**, with executable work tracked as GitHub Issues. Use issue checklists and `Closes #N` in PR descriptions. Cross-reference the [ai-desktop](https://github.com/markymark5127/ai-desktop) repo for the GTK launcher and AI features.

### Definitions

- `P0` — blocks safe bootable alpha/reliable build
- `P1` — core beta user experience
- `P2` — advanced feature or release scaling
- **Source-complete** — implementation exists in the repository; verification still required
- **Verified** — image built, booted, UI tested, evidence recorded on its issue
- **Done** — all issue acceptance items satisfied and applicable code merged

## Milestone M0 — Verified bootable alpha

**Exit gate:** fresh installed virtual machine boots, looks like Mutsu OS, shows one-time welcome, launches Mutsu Search, has rollback tested, and does not break GNOME or Bazzite gaming. Do not publish a "ready" ISO before this.

| Priority | Task | Source status | Remaining |
| --- | --- | --- | --- |
| P0 | [#8 Reliable image build & CI](https://github.com/markymark5127/mutsu-os/issues/8) | Preflight checks, prepare-desktop, tests, and build workflow exist | Real OCI build + boot smoke evidence |
| P0 | [#14 Adaptive GNOME extension safe enable/disable](https://github.com/markymark5127/mutsu-os/issues/14) | Install script does **not** overwrite enabled-extensions; extension disabled by default; disable() cleans up | Live GNOME Shell testing + version narrowing |
| P0 | [#10 Pinned desktop source/release process](https://github.com/markymark5127/mutsu-os/issues/10) | Pin in `desktop-source.env`; CI runs tests against staged code | Documented deliberate bump + release notes process |
| P0 | [#9 First-run, shortcut and app-grid integration](https://github.com/markymark5127/mutsu-os/issues/9) | First-login desktop file, shortcut dconf, and check script exist | Fresh-user GNOME session verification |
| P0 | [#11 Bootc disk-image/ISO installation](https://github.com/markymark5127/mutsu-os/issues/11) | Blueprint TOML + workflow present; anaconda-iso noted as legacy | Validated modern installer + real install/boot test |
| P0 | [#13 Boot, update, rollback & hardware QA](https://github.com/markymark5127/mutsu-os/issues/13) | Matrix described in issues and docs | Actual VM/hardware runs + evidence |
| P1 | [#12 Brand GNOME About, GDM, Plymouth, installer](https://github.com/markymark5127/mutsu-os/issues/12) | Icons, wallpapers, install-branding.sh, and os-release handling exist | Visual smoke + Plymouth/installer branding verification |

**Existing source:** `Containerfile`, `build_files/build.sh`, `packaging/prepare-desktop.sh`, `packaging/install-branding.sh`, `branding/icons`, `branding/wallpapers`, `packaging/mutsu-first-login`, `packaging/check-integration.py`, `.github/workflows/build.yml`. These are starting points, **not** proof of passing the gate.

## Milestone M1 — Mac-familiar GNOME and Yoga tablet experience

**Exit gate:** GNOME UI is consistent with approved Mutsu OS Japandi/Cyberpunk references; touch/keyboard interactions work safely; extension can be disabled or rolled back.

| Priority | Task | Source status | Remaining |
| --- | --- | --- | --- |
| P1 | [#17 Top bar, floating dock, app grid, overview](https://github.com/markymark5127/mutsu-os/issues/17) | Prototype notes and extension panel indicator | Shell identity changes + verification |
| P1 | [#19 Native Spotlight app/file/action integration](https://github.com/markymark5127/mutsu-os/issues/19) | mutsu-search launcher and Super+Space default | OS-native overlay reliability |
| P1 | [#18 System-coherent Japandi/Cyberpunk appearance](https://github.com/markymark5127/mutsu-os/issues/18) | Wallpapers and app-scoped styles | Full Shell/GTK theme layers + rollback |
| P1 | [#15 Real convertible tablet-mode sensor integration](https://github.com/markymark5127/mutsu-os/issues/15) | Manual modes exist; Automatic is a scaffold | SW_TABLET_MODE wiring |
| P1 | [#16 Touch gestures, tablet Home, accessibility](https://github.com/markymark5127/mutsu-os/issues/16) | Experimental bottom-edge actor (off by default) | Real touch testing |

**Current prototype:** `extensions/mutsu-adaptive@mutsu-os/extension.js` has manual modes, home/maximize, and experimental pointer-like gesture logic that is **off unless explicitly enabled**. Automatic posture detection is unimplemented. The install script preserves Bazzite's extension list.

## Milestone M2 — AI, phone and gaming integration

**Exit gate:** optional user-approved Newelle works, no unsolicited model calls, legitimate OS tasks stay permissioned, supported gaming/connectivity claims verified.

| Priority | Task | Source status | Remaining |
| --- | --- | --- | --- |
| P1 | [#20 Newelle install/provision + model permission](https://github.com/markymark5127/mutsu-os/issues/20) | Setup scripts and wizard hooks exist; no baked credentials | First-run opt-in + end-to-end test |
| P2 | [#21 Safe MCP and action broker](https://github.com/markymark5127/mutsu-os/issues/21) | Specs in ai-desktop | Policy tests + permission UI |
| P2 | [#22 GSConnect + capability-aware iPhone/Android pairing](https://github.com/markymark5127/mutsu-os/issues/22) | QR / docs references | Functional pairing + capability detection |
| P1 | [#23 Steam, Proton and GPU qualification](https://github.com/markymark5127/mutsu-os/issues/23) | Bazzite base preserved | Hardware matrix verification |

**Current source:** Newelle API client, setup wizard, and user-service scripts exist in the pinned ai-desktop. A preconfigured Newelle Flatpak/model/account does **not** ship in the image. Never bake user credentials or opt-in consent into an immutable OS.

## Milestone M3 — Distributable public beta

**Exit gate:** tested installer artifacts, signed and reproducible image releases, documented updates/recovery, user support and preservation of Bazzite/Universal Blue/Fedora licenses.

| Priority | Task | Source status | Remaining |
| --- | --- | --- | --- |
| P2 | [#24 Release channels, downloads and recovery docs](https://github.com/markymark5127/mutsu-os/issues/24) | See `docs/INSTALL_AND_RECOVERY.md` | Real signed artifacts + public beta gates |

## Next work order

1. Obtain **real container build + boot evidence**: [#8](https://github.com/markymark5127/mutsu-os/issues/8).
2. Live-test the Adaptive Desktop extension (still disabled by default): [#14](https://github.com/markymark5127/mutsu-os/issues/14).
3. Verify the first GNOME user session: [#9](https://github.com/markymark5127/mutsu-os/issues/9).
4. Produce and boot-test a qcow2 or ISO: [#11](https://github.com/markymark5127/mutsu-os/issues/11).
5. Proceed to visual Shell changes, tablet posture, and AI only after the safe boot foundation.

## Source-to-image integration and risk notes

- `mutsu-os` owns OCI builds, GNOME image defaults, system branding, extensions, disk installer, and hardware validation.
- `ai-desktop` owns Mutsu Search GTK app, AI client, onboarding preferences, safe tool broker, app-scoped styles, and text/file search.
- **Cross-repo pin:** `packaging/desktop-source.env` records the reviewed `ai-desktop` commit. The build includes provenance. CI runs headless tests before the image build. Bumps are deliberate. [#10](https://github.com/markymark5127/mutsu-os/issues/10)
- **Alpha safety:** `packaging/install-adaptive-extension.sh` installs the experimental extension **disabled by default**, without overriding Bazzite's `enabled-extensions`, and requires strict schema compilation. Bottom-edge gestures are off unless the experimental setting is enabled. Live GNOME testing is still required before closing [#14](https://github.com/markymark5127/mutsu-os/issues/14).
- `extension.js` does **not** implement automatic tablet posture.
- `.github/workflows/build-disk.yml` still references the legacy `anaconda-iso` type. The blueprint metadata fields are valid, but the installer is not yet boot-tested. [#11](https://github.com/markymark5127/mutsu-os/issues/11)
- **Do not infer success from the presence of workflow files.** Attach CI logs, boot screenshots, or `bootc rollback` evidence to issues before marking them verified.

## How to maintain this tracker

- Comment on an issue when starting work.
- Reference `Closes #N` in PRs.
- After merge, attach verification evidence before checking acceptance items.
- Update this document when priorities or source status change.
