# Mutsu OS development tracker

**Status as of November 13, 2026:** features and the Shoji Glass look are in, and images build and pass the GNOME runtime check (headless GNOME Shell in CI, with screenshots). What stands between here and a **developer alpha** is making updates safe. Beta and 1.0 work has not started. The same plan is kept visually on the roadmap whiteboard; keep the two in step.

This is the canonical **release roadmap**, with executable work tracked as GitHub Issues. Use issue checklists and `Closes #N` in PR descriptions. Cross-reference the [ai-desktop](https://github.com/markymark5127/ai-desktop) repo for the GTK launcher and AI features.

## Where we are: developer alpha → beta → 1.0

### Done (in the image, CI-checked)

- Tablet mode (fold, rotate, Home, dock), Split View, Slide Over, one multitasking card per window
- On-screen keyboard; gamepad hides it with a real pad and remembers its layout
- Mutsu Search, Mutsu Mechanic (now a chat inside Search) and local AI
- Online and offline live USB installers (live boot tested in a VM)
- Japandi sage palette, Mac shortcuts (keyd; Toshy removed)
- Software Updates and Mutsu Search pages in GNOME Settings
- Welcome wizard: Wi-Fi, look and keyboard, phone, AI privacy, backups
- Shoji Glass theme for the Shell: glass top bar with adaptive ink, glass dock, menus and notifications; Japandi object icons; a matching cursor set
- Black-screen login fixed; log warnings quieted; faster tablet/desktop switch
- One image built and passed the GNOME runtime check

### Developer alpha: what's left

The goal: a tester can install it and update without ever being stranded.

1. **GNOME runtime check tests the exact image it follows.** It still pulls `latest` and overlays the commit's extensions; it should pull `latest-<sha>` of the build that triggered it and check out that commit.
2. **Installer ISO from a tested image.** ISO builds are running; they should only use an image that passed step 1.
3. **Updates only offer images that passed testing.** Publish a `tested` tag after the runtime check passes; the Software Updates page and `bootc` follow that tag, not `latest`.
4. **Roll back on its own if login fails** (for example greenboot-style boot checks, or a GDM-reached marker with `bootc rollback` on repeated failure).
5. **A real version number, release notes and known issues.** `os-release` currently says "Mutsu OS 1.0 (Shibui)"; use e.g. `0.1 alpha` plus the build date and commit.
6. **Fix the intermittent "factor" Shell error** (`mutsu-adaptive`: `can't access property "factor", obj is null`; seen in the runtime check on November 13).
7. **Test on the Yoga:** switch speed, login screen and the glass look (Slide Over and Search are confirmed).

### Beta

- Automated install test in CI (today the ISO only boots live; it never installs)
- Local AI end-to-end test and a "Repair AI" button in Mechanic
- Tablet and gamepad pages in Settings (Search and Updates exist)
- Battery: limit charging to 80%
- "Report a problem" log bundle in Mechanic
- Dark mode pass for Shoji Glass (the top bar adapts; the rest is light only)

### 1.0

- Framework 12 hardware pass
- Stylus: pen buttons, palm rejection, notes
- Fingerprint and the tablet lock screen
- Secure Boot confirmed end to end
- Office apps decision (the first-boot portal only offers one today) and more languages (English only)
- A user guide and a support channel

The issue-based milestones below are the older, more detailed tracker; their "Remaining" columns predate the list above.

### Definitions

- `P0` — blocks safe bootable alpha/reliable build
- `P1` — core beta user experience
- `P2` — advanced feature or release scaling
- **Source-complete** — implementation exists in the repository; verification still required
- **Verified** — image built, booted, UI tested, evidence recorded on its issue
- **Done** — all issue acceptance items satisfied and applicable code merged

## Milestone M0 — Verified bootable alpha

**Exit gate:** fresh installed virtual machine boots, looks like Mutsu OS, shows one-time welcome, launches Mutsu Search, has rollback tested, and does not break GNOME or gaming. Do not publish a "ready" ISO before this.

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
| P1 | [#15 Real convertible tablet-mode sensor integration](https://github.com/markymark5127/mutsu-os/issues/15) | Automatic combines Mutter touch-mode, kernel tablet switches and iio hinge angles; QS override until next fold | Real 2-in-1 validation |
| P1 | [#16 Touch gestures, tablet Home, accessibility](https://github.com/markymark5127/mutsu-os/issues/16) | iPadOS-style Home (pull-down search, folders, edit mode), bottom-edge gestures, multitasking blades with traffic lights; simulated tests in CI | Real touch testing |

**Current:** `extensions/mutsu-adaptive@mutsu-os` provides Automatic/Desktop/Tablet modes, a tablet Home behind windows, full-screen apps, bottom-edge navigation, multitasking blades, Split View/Slide Over and a crash-safe settings journal; see its README. The install script preserves the existing extension list.

## Milestone M2 — AI, phone and gaming integration

**Exit gate:** optional user-approved Newelle works, no unsolicited model calls, legitimate OS tasks stay permissioned, supported gaming/connectivity claims verified.

| Priority | Task | Source status | Remaining |
| --- | --- | --- | --- |
| P1 | [#20 Newelle install/provision + model permission](https://github.com/markymark5127/mutsu-os/issues/20) | Setup scripts and wizard hooks exist; no baked credentials | First-run opt-in + end-to-end test |
| P2 | [#21 Safe MCP and action broker](https://github.com/markymark5127/mutsu-os/issues/21) | Specs in ai-desktop | Policy tests + permission UI |
| P2 | [#22 GSConnect + capability-aware iPhone/Android pairing](https://github.com/markymark5127/mutsu-os/issues/22) | QR / docs references | Functional pairing + capability detection |
| P1 | [#23 Steam, Proton and GPU qualification](https://github.com/markymark5127/mutsu-os/issues/23) | Gaming base preserved | Hardware matrix verification |

**Current source:** Newelle API client, setup wizard, and user-service scripts exist in the pinned ai-desktop. The image now packages Newelle, its API dependencies and Qwen 3.5 9B through Ollama, with automatic local per-user configuration; fresh offline VM validation remains outstanding. Never bake user credentials or opt-in consent into an immutable OS.

## Milestone M3 — Distributable public beta

**Exit gate:** tested installer artifacts, signed and reproducible image releases, documented updates/recovery, user support and preservation of upstream licenses.

| Priority | Task | Source status | Remaining |
| --- | --- | --- | --- |
| P2 | [#24 Release channels, downloads and recovery docs](https://github.com/markymark5127/mutsu-os/issues/24) | See `docs/INSTALL_AND_RECOVERY.md` | Real signed artifacts + public beta gates |

## Next work order

Follow the developer alpha list above, in order: exact-image runtime check, tested-only updates, automatic rollback, real version number, then the "factor" error. Beta items are small and independent after that; 1.0 needs the hardware to test on.

## Source-to-image integration and risk notes

- `mutsu-os` owns OCI builds, GNOME image defaults, system branding, extensions, disk installer, and hardware validation.
- `ai-desktop` owns Mutsu Search GTK app, AI client, onboarding preferences, safe tool broker, app-scoped styles, and text/file search.
- **Cross-repo pin:** `packaging/desktop-source.env` records the reviewed `ai-desktop` commit. The build includes provenance. CI runs headless tests before the image build. Bumps are deliberate. [#10](https://github.com/markymark5127/mutsu-os/issues/10)
- **Alpha safety:** `packaging/install-adaptive-extension.sh` installs the extension without overriding the existing `enabled-extensions` list, and requires strict schema compilation. Bottom-edge gestures are off unless the experimental setting is enabled. Live GNOME testing is still required before closing [#14](https://github.com/markymark5127/mutsu-os/issues/14).
- Automatic tablet posture is implemented but **unverified on real hardware**.
- `.github/workflows/build-disk.yml` still references the legacy `anaconda-iso` type. The blueprint metadata fields are valid, but the installer is not yet boot-tested. [#11](https://github.com/markymark5127/mutsu-os/issues/11)
- **Do not infer success from the presence of workflow files.** Attach CI logs, boot screenshots, or `bootc rollback` evidence to issues before marking them verified.

## How to maintain this tracker

- Comment on an issue when starting work.
- Reference `Closes #N` in PRs.
- After merge, attach verification evidence before checking acceptance items.
- Update this document when priorities or source status change.
