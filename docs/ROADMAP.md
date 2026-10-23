# Mutsu OS development tracker

**Status as of October 23, 2026:** Bootc/Bazzite image integration and a GNOME desktop prototype are present in source. **A verified, installed, user-ready Mutsu OS beta is not established by repository inspection alone.** The image build, boot, installer and hardware checks must be proven with CI/VM results.

This is the canonical **release roadmap**, with executable work tracked as GitHub Issues in [Mutsu OS Issues](https://github.com/markymark5127/mutsu-os/issues). Use the issue completion checklists and `Closes #N` in PR descriptions. Work on the separate [ai-desktop](https://github.com/markymark5127/ai-desktop) codebase should link the corresponding Mutsu OS issue.

### Definitions

- `P0` — blocks safe bootable alpha/reliable build
- `P1` — core beta user experience
- `P2` — advanced feature or release scaling
- **Implemented** — source/config exists, not necessarily proved on target GNOME hardware
- **Verified** — image built, booted, UI tested, evidence recorded on its issue
- **Done** — all issue acceptance items satisfied and applicable code merged

## Milestone M0 — Verified bootable alpha

**Exit gate:** fresh installed virtual machine boots, looks like Mutsu OS, shows one-time welcome, launches Mutsu Search, has rollback tested, and does not break GNOME or Bazzite gaming. Do not publish a "ready" ISO before this.

| Priority | Task | Dependency |
| --- | --- | --- |
| P0 | [#8 Reliable image build & CI](https://github.com/markymark5127/mutsu-os/issues/8) | First |
| P0 | [#14 Adaptive GNOME extension safe enable/disable](https://github.com/markymark5127/mutsu-os/issues/14) | #8 |
| P0 | [#10 Pinned desktop source/release process](https://github.com/markymark5127/mutsu-os/issues/10) | #8 |
| P0 | [#9 First-run, shortcut and app-grid integration](https://github.com/markymark5127/mutsu-os/issues/9) | #8, #10 |
| P0 | [#11 Bootc disk-image/ISO installation](https://github.com/markymark5127/mutsu-os/issues/11) | #8 |
| P0 | [#13 Boot, update, rollback & hardware QA](https://github.com/markymark5127/mutsu-os/issues/13) | #8, #9, #11 |
| P1 | [#12 Brand GNOME About, GDM, Plymouth, installer](https://github.com/markymark5127/mutsu-os/issues/12) | #8, #11 |

**Existing source:** `Containerfile`, `build_files/build.sh`, `packaging/prepare-desktop.sh`, `packaging/install-branding.sh`, `branding/icons`, `branding/wallpapers`, `packaging/mutsu-first-login`, `packaging/check-integration.py`. These are starting points, **not** proof of passing the gate.

## Milestone M1 — Mac-familiar GNOME and Yoga tablet experience

**Exit gate:** GNOME UI is consistent with approved Mutsu OS Japandi/Cyberpunk references; touch/keyboard interactions work safely; extension can be disabled or rolled back.

| Priority | Task | Dependency |
| --- | --- | --- |
| P1 | [#17 Top bar, floating dock, app grid, overview](https://github.com/markymark5127/mutsu-os/issues/17) | #14 |
| P1 | [#19 Native Spotlight app/file/action integration](https://github.com/markymark5127/mutsu-os/issues/19) | #9, #17 |
| P1 | [#18 System-coherent Japandi/Cyberpunk appearance](https://github.com/markymark5127/mutsu-os/issues/18) | #17 |
| P1 | [#15 Real convertible tablet-mode sensor integration](https://github.com/markymark5127/mutsu-os/issues/15) | #14 |
| P1 | [#16 Touch gestures, tablet Home, accessibility](https://github.com/markymark5127/mutsu-os/issues/16) | #14, #15 |

**Current prototype:** `extensions/mutsu-adaptive@mutsu-os/extension.js` has manual modes, home/maximize and experimental pointer-like gesture logic. **Automatic posture detection is explicitly unimplemented.** It also has a potentially destructive GNOME enabled-extension default that must be corrected in #14.

## Milestone M2 — AI, phone and gaming integration

**Exit gate:** optional user-approved Newelle works, no unsolicited model calls, legitimate OS tasks stay permissioned, supported gaming/connectivity claims verified.

| Priority | Task | Dependency |
| --- | --- | --- |
| P1 | [#20 Newelle install/provision + model permission](https://github.com/markymark5127/mutsu-os/issues/20) | #9, #10 |
| P2 | [#21 Safe MCP and action broker](https://github.com/markymark5127/mutsu-os/issues/21) | #20 |
| P2 | [#22 GSConnect + capability-aware iPhone/Android pairing](https://github.com/markymark5127/mutsu-os/issues/22) | #9 |
| P1 | [#23 Steam, Proton and GPU qualification](https://github.com/markymark5127/mutsu-os/issues/23) | #13 |

**Current source:** Newelle API client, setup wizard and user-service scripts exist; a preconfigured Newelle Flatpak/model/account does **not** ship in the image. Never bake user credentials or opt-in consent into an immutable OS.

## Milestone M3 — Distributable public beta

**Exit gate:** tested installer artifacts, signed and reproducible image releases, documented updates/recovery, user support and preservation of Bazzite/Universal Blue/Fedora licenses.

| Priority | Task | Dependency |
| --- | --- | --- |
| P2 | [#24 Release channels, downloads and recovery docs](https://github.com/markymark5127/mutsu-os/issues/24) | #11, #12, #13, #18, #20, #23 |

## Next work order

1. Run image CI and obtain **real container build/boot evidence**: [#8](https://github.com/markymark5127/mutsu-os/issues/8).
2. Fix GNOME Adaptive extension compatibility **before installing to real hardware**: [#14](https://github.com/markymark5127/mutsu-os/issues/14).
3. Verify the first GNOME user session, including `mutsu-search` and model permission: [#9](https://github.com/markymark5127/mutsu-os/issues/9).
4. Produce a bootable qcow2 or ISO and prove fresh installation: [#11](https://github.com/markymark5127/mutsu-os/issues/11).
5. Proceed to visual GNOME Shell changes, tablet posture and AI only after the safe boot foundation.

## Source-to-image integration and risk notes

- `mutsu-os` owns OCI builds, GNOME image defaults, system branding, extensions, disk installer and hardware validation.
- `ai-desktop` owns Mutsu Search GTK app, AI client, onboarding preferences, safe tool broker, app-scoped styles and text/file search.
- **Proposed cross-repo pin:** `packaging/desktop-source.env` records `ai-desktop` commit `9fe8d1c7b958fc96fa472313020cdd5c5729c97b`; the build now includes provenance in `/usr/share/mutsu-os/build-info/desktop-source.env`. CI runs both repos' headless tests before image build. A release bump is still deliberate and VM-tested. [#10](https://github.com/markymark5127/mutsu-os/issues/10)
- **Proposed alpha safety patch:** `packaging/install-adaptive-extension.sh` now installs the experimental extension **disabled by default**, without overriding Bazzite's `enabled-extensions`; and requires strict GSettings schema compilation. The edge-gesture actor is off unless the user explicitly enables an experimental switch. Still requires live GNOME Shell compatibility testing before [#14](https://github.com/markymark5127/mutsu-os/issues/14) can close.
- `extension.js` currently **does not implement automatic tablet posture**, despite a selectable Automatic mode.
- `.github/workflows/build-disk.yml` still uses legacy `anaconda-iso`. The ISO blueprint's `name`, `version` and `description` **are supported** (not malformed), and explicit media branding fields have been added. Migration to a supported modern installer plus a real install/boot test is still open. [#11](https://github.com/markymark5127/mutsu-os/issues/11)
- No verified successful current booted-image smoke test was available during this source review; **do not infer success from the presence of a CI workflow file**.

## Cross-repository feature specifications

Detailed prototype intentions already exist in [ai-desktop Issues #1–#12](https://github.com/markymark5127/ai-desktop/issues) and in [Mutsu's Adaptive Desktop spec](ADAPTIVE_DESKTOP_IMAGE.md). Keep those implementation details; use the Mutsu OS issues above for **image acceptance, release blockers and integrated verification**.

## How to maintain this tracker

- When starting a task: comment on its issue with approach/branch.
- When proposing a fix: reference it with `Closes #<number>` in the PR.
- When the PR merges: attach VM/screenshots/CI evidence to the issue; mark done only after verifying its acceptance checklist.
- When a task grows: open a new issue from the provided issue form, reference its parent and dependencies here.
- Update this document when priorities/dependencies change, not to mirror every commit.
