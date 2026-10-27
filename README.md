# Mutsu OS

> **Development tracker:** [Master issue #26](https://github.com/markymark5127/mutsu-os/issues/26) · [Roadmap and milestones](docs/ROADMAP.md) · [Install & recovery](docs/INSTALL_AND_RECOVERY.md) · [All open OS issues](https://github.com/markymark5127/mutsu-os/issues) · [Create a tracked task](https://github.com/markymark5127/mutsu-os/issues/new/choose)

**Mutsu OS** is a Bazzite GNOME-derived, Mac-familiar Linux desktop with Steam/Proton gaming support, two visual styles (Calm Japandi and Cyberpunk), a compact Spotlight-style app/file launcher, and optional Mutsu AI help.

This repository is the **bootc image build**. The related [ai-desktop](https://github.com/markymark5127/ai-desktop) repository contains the Python GTK4 launcher, initial setup wizard, search, AI tool broker, and user-session preferences. The latter is pinned here to one reviewed commit rather than being updated silently every build.

**Verification status:** Source and packaging for an alpha prototype exist. A verified bootable image (fresh VM install, first-run, rollback) has not yet been established. See the [roadmap](docs/ROADMAP.md) before treating any build as ready for daily use.

## What this image currently includes

- Based on `ghcr.io/ublue-os/bazzite-gnome:stable` with Bazzite/Steam hardware support intact; upstream technical distro IDs are preserved.
- Mutsu OS identity in `os-release`, GNOME About icon, GDM greeter wordmark.
- Original Mutsu two-wave SVGs and **both 3840×2160 wallpapers**, installed in standard shared paths.
- First-stage **MutsuJapandi icon theme** with Adwaita/hicolor fallback, Mutsu-owned app/action icons, and a system green accent; see [Japandi icon guide](docs/JAPANDI_ICONS.md). The full GNOME app icon set is not yet redesigned.
- A new GNOME 50 user gets the **Japandi desktop**: 4K sage wallpaper, light appearance, sage Mutsu top-bar identity, and a compact bottom floating Dash-to-Dock. Desktop choices remain user-overridable and previous custom wallpapers/themes are not reset.
- `/usr/bin/mutsu-search` — a system-installed, GNOME-integrated Mutsu Search launcher with real local app search, a bounded local file search, and an optional AI fallback.
- An app-grid entry **Mutsu OS Search**, using the SVG icon.
- A GNOME autostart entry launching the first-run setup wizard **once per user**, until setup is completed or skipped. It respects the `~/.config/ai-desktop/onboarding.json` setting.
- A user-overridable **Super / Command + Space** GNOME shortcut default for Mutsu Search; input-language switching is moved to Shift+Super+Space. No shortcuts are locked by policy.
- **Mac-familiar interface defaults** for new users (fully overridable): window buttons on the upper left, 12-hour clock, hot corners disabled. See `packaging/30-mutsu-mac-defaults.dconf`.
- The Mutsu AI result displays the installed emblem if no separate AI SVG exists. The assistant is opt-in and off by default for model requests.
- Optional Newelle user-service and key-configuration scripts are installed in `/usr/share/mutsu-os/scripts`.

**Alpha status:** Mutsu logo, wallpaper, top-bar extension source, branded Anaconda ISO and Plymouth script theme are packaged. Custom Plymouth assets are staged, but the OS retains Bazzite's OSTree-compatible initramfs for reliable boot. Newelle is installed through a network-dependent, **one-time first-boot** Flatpak service (retry on a later boot if offline, and no forced reinstallation after user removal) (the AI model, account and credentials are intentionally not bundled). System-wide GTK/Qt appearance, native GNOME Spotlight, a custom icon pack, dock/overview polish and automatic tablet posture are not finished. **Bootable-media and fresh-install tests remain outstanding**; see [clean-install QA](docs/INITIAL_INSTALL_QA.md). These are separate milestones.

## Adaptive Desktop (planned)

The convertible / 2-in-1 experience (MacBook-like when open, iPad-like app-grid Home when folded, with bottom-edge swipe gestures) is specified for the image in [docs/ADAPTIVE_DESKTOP_IMAGE.md](docs/ADAPTIVE_DESKTOP_IMAGE.md). The extension is installed but **not enabled by default**. Automatic posture detection is not wired. Enable only on a disposable test VM.

## Build from source (requires Git, Just, Podman)

```bash
git clone https://github.com/markymark5127/mutsu-os.git
cd mutsu-os

# Automatically done by "just build"; can also be run explicitly:
bash packaging/prepare-desktop.sh
python3 packaging/check-integration.py

# Builds an OCI container image; not an installed system or a disk image.
just build
```

`packaging/desktop-source.env` pins one reviewed revision of `markymark5127/ai-desktop`; `packaging/prepare-desktop.sh` stages it at `vendor/ai-desktop/`. This directory is ignored by Git. The build copies only its `src/` code and two optional setup scripts into the OS image. **No personal Newelle token or `~/.config` content is included.** Update the pinned SHA intentionally after validating the app. Local builds require network access for first staging; GitHub Actions also stages the exact pinned revision before compiling the image.

Image source:
- `Containerfile` — bootc/Bazzite base and bundled Mutsu runtime.
- `branding/` and `packaging/install-branding.sh` — wallpapers, icons, `os-release` and greeter cosmetics.
- `build_files/build.sh` — system packages (GTK4, PyGObject, libadwaita).
- `packaging/mutsu-first-login` — per-user first-run onboarding.
- `packaging/90-mutsu-wallpaper.gschema.override` — initial GNOME background default, overridable by each user.
- `packaging/20-mutsu-shortcut.dconf` — GNOME shortcut default for new users, overridable in Settings.
- `packaging/30-mutsu-mac-defaults.dconf` — left window buttons and other Mac-familiar interface defaults.
- `packaging/40-mutsu-japandi-defaults.dconf`, `packaging/configure-native-desktop.py` and the Mutsu GNOME Shell extension — **native system image defaults** for wallpaper, light appearance, floating dock and top-bar branding. GNOME loads them at the start of a new user session, without a first-login theming script. Existing user overrides continue to win.

The GitHub Actions [image workflow](.github/workflows/build.yml) runs preflight checks and the pinned desktop's Python tests before building the OCI image. It also runs a headless app import/CLI smoke check inside the container; neither is a substitute for a real GNOME boot test. Container builds/publishing to GHCR are gated to trusted branch events. The preflight checks are in `tests/test_release_integration.py`.

**Experimental tablet-mode extension:** installed but **not automatically enabled** until its GNOME Shell APIs and hardware behavior have been validated. On a disposable test VM, enable with `gnome-extensions enable mutsu-adaptive@mutsu-os`; disable with `gnome-extensions disable mutsu-adaptive@mutsu-os`. Automatic hinge posture detection is not wired yet, and bottom-edge gesture capture defaults OFF. Default enabled extensions are composed at image-build time from available vendor defaults plus Mutsu, without locking users into them. Existing GNOME users with personalized extension lists may need to enable the new extensions manually.

The GitHub Actions [image workflow](.github/workflows/build.yml) builds and publishes container images to GHCR after a merge to `main`. Verify repository signing settings (including `SIGNING_SECRET`) before depending on signed images. Do not rebase a working physical system until you have tested a generated VM/disk image and confirmed updates/rollback. See [docs/INSTALL_AND_RECOVERY.md](docs/INSTALL_AND_RECOVERY.md).

## Testing the installed desktop

In a **disposable GNOME VM booted into the resulting image**:

```bash
cat /usr/lib/os-release | grep -E '^(NAME|PRETTY_NAME|LOGO)='
ls /usr/share/backgrounds/mutsu/
ls /usr/share/icons/hicolor/scalable/apps/mutsu-os-logo.svg
command -v mutsu-search
mutsu-search --search files
```

Log into GNOME as a new user: the first-run wizard should appear once. Closing or completing the wizard should not lose the user's app preferences. Use **Show Applications → Mutsu OS Search** to open Spotlight. The appearance selector switches wallpaper; System can restore a previously set user wallpaper. Newelle should be installed system-wide once the first online boot completes, but a model/provider and private credentials must still be configured before the inference backend can answer.

### Newelle (opt-in)

Newelle is a Flatpak, and its model/API authentication is **personal**. Do not bake an API token into a publicly distributed image. After installing Newelle, configure its local authenticated GUI API and model, then follow:

```bash
bash /usr/share/mutsu-os/scripts/configure-newelle-key.sh
bash /usr/share/mutsu-os/scripts/install-newelle-service.sh
mutsu-search --check-newelle
```

The interactive wizard can direct users through this. The original [Newelle setup guide](https://github.com/markymark5127/ai-desktop/blob/main/docs/NEWELLE_SETUP.md) covers configuration and troubleshooting. Permission to send prompts or diagnostic data remains an unchecked-by-default, revocable choice in Mutsu settings; model-proposed system changes still require a separate approval.

The optional ISO workflow references `disk_config/iso.toml`, containing supported `name`/`version`/`description` blueprint metadata and `[customizations.iso]` media labels. The workflow still requests the legacy `anaconda-iso` type. These are valid blueprint fields, but the resulting installer is not yet boot/installation tested; the modern bootc installer migration is tracked in [#11](https://github.com/markymark5127/mutsu-os/issues/11).

## Remaining distribution tasks

See the [ai-desktop roadmap](https://github.com/markymark5127/ai-desktop/blob/main/docs/ROADMAP.md) and [docs/ADAPTIVE_DESKTOP_IMAGE.md](docs/ADAPTIVE_DESKTOP_IMAGE.md). High priorities are a GNOME Shell extension for a real native Spotlight overlay and top-left Mutsu logo; version-compatible extension packaging; Adaptive Desktop (tablet posture, app-grid Home, bottom-edge gestures); genuine custom Plymouth/ISO boot images; and Newelle Flatpak first-boot provisioning.

Source projects remain attributed to Bazzite, Universal Blue and Fedora; the visible **Mutsu OS** name does not remove upstream dependencies, copyright, or licensing obligations.
