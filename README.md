# Mutsu OS

**Mutsu OS** is a Bazzite GNOME-derived, Mac-familiar Linux desktop with
Steam/Proton gaming support, two visual styles (Calm Japandi and Cyberpunk),
a compact Spotlight-style app/file launcher and optional Mutsu AI help.

This repository is the **bootc image build**. The related
[ai-desktop](https://github.com/markymark5127/ai-desktop) repository contains
the Python GTK4 launcher, initial setup wizard, search, AI tool broker and
user-session preferences. The latter is pinned here to one reviewed commit
rather than being updated silently every build.

## What this image currently includes

- Based on `ghcr.io/ublue-os/bazzite-gnome:stable` with Bazzite/Steam hardware
  support intact; upstream technical distro IDs are preserved.
- Mutsu OS identity in `os-release`, GNOME About icon, GDM greeter wordmark.
- Original Mutsu two-wave SVGs and **both 3840×2160 wallpapers**, installed in
  standard shared paths.
- GNOME defaults to the Calm Japandi wallpaper on **new users**; existing
  user wallpaper selections are left intact.
- `/usr/bin/mutsu-search` — a system-installed, GNOME-integrated Mutsu Search
  launcher with real local app search, a bounded local file search and
  an optional AI fallback.
- An app-grid entry **Mutsu OS Search**, using your SVG icon.
- A GNOME autostart entry launching the first-run setup wizard **once per
  user**, until setup is completed or skipped. It respects the
  `~/.config/ai-desktop/onboarding.json` setting.
- A user-overridable **Super / Command + Space** GNOME shortcut default for
  Mutsu Search; input-language switching is moved to Shift+Super+Space. No
  shortcuts are locked by policy.
- The Mutsu AI result displays your installed emblem if no separate AI SVG
  exists. The assistant is opt-in and off by default for model requests.
- Optional Newelle user-service and key-configuration scripts are installed
  in `/usr/share/mutsu-os/scripts`.

**Not included yet:** a bundled/configured Newelle model, system-wide
Japandi/Cyberpunk GTK/GNOME Shell style, full GNOME Shell-native Spotlight integration,
custom app icon pack, touch-first Yoga tablet mode, native blur, a branded
Plymouth animation, or a branded Anaconda installer. These are separate
milestones. The first build should prove **branding and OS packaging**
before they are introduced.

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

`packaging/prepare-desktop.sh` checks out a fixed revision of
`markymark5127/ai-desktop` at `vendor/ai-desktop/`. This directory is ignored
by Git. The build copies only its `src/` code and two optional setup scripts
into the OS image. **No personal Newelle token or `~/.config` content is
included.** Update the pinned SHA intentionally after validating the app.
Local builds require network access for first staging; GitHub Actions also
stages the exact pinned revision before compiling the image.

Image source:
- `Containerfile` — bootc/Bazzite base and bundled Mutsu runtime.
- `branding/` and `packaging/install-branding.sh` — wallpapers, icons,
  `os-release` and greeter cosmetics.
- `build_files/build.sh` — system packages (GTK4, PyGObject, libadwaita).
- `packaging/mutsu-first-login` — per-user first-run onboarding.
- `packaging/90-mutsu-wallpaper.gschema.override` — initial GNOME background
  default, overridable by each user.
- `packaging/20-mutsu-shortcut.dconf` — GNOME shortcut default for new
  users, overridable in Settings.

The GitHub Actions [image workflow](.github/workflows/build.yml) builds and
publishes container images to GHCR after a merge to `main`. Verify repository
signing settings (including `SIGNING_SECRET`) before depending on signed images.
Do not rebase a working physical system until you have tested a generated
VM/disk image and confirmed updates/rollback.

## Testing the installed desktop

In a **disposable GNOME VM booted into the resulting image**:

```bash
cat /usr/lib/os-release | grep -E '^(NAME|PRETTY_NAME|LOGO)='
ls /usr/share/backgrounds/mutsu/
ls /usr/share/icons/hicolor/scalable/apps/mutsu-os-logo.svg
command -v mutsu-search
mutsu-search --search files
```

Log into GNOME as a new user: the first-run wizard should appear once.
Closing or completing the wizard should not lose the user's app preferences.
Use **Show Applications → Mutsu OS Search** to open Spotlight. The
appearance selector switches wallpaper; System can restore a previously
set user wallpaper. Newelle must be installed/configured separately before
its inference backend can answer.

### Newelle (opt-in)

Newelle is a Flatpak, and its model/API authentication is **personal**. Do not
bake an API token into a publicly distributed image. After installing Newelle,
configure its local authenticated GUI API and model, then follow:

```bash
bash /usr/share/mutsu-os/scripts/configure-newelle-key.sh
bash /usr/share/mutsu-os/scripts/install-newelle-service.sh
mutsu-search --check-newelle
```

The interactive wizard can direct users through this. The original
[Newelle setup guide](https://github.com/markymark5127/ai-desktop/blob/main/docs/NEWELLE_SETUP.md)
covers configuration and troubleshooting. Permission to send prompts or
diagnostic data remains an unchecked-by-default, revocable choice in Mutsu
settings; model-proposed system changes still require a separate approval.

The optional ISO workflow also expects `disk_config/iso.toml`, now present
with only Mutsu installer metadata. The installer itself still requires
separate artwork and physical/VM installation testing.

## Remaining distribution tasks

See the [ai-desktop roadmap](https://github.com/markymark5127/ai-desktop/blob/main/docs/ROADMAP.md).
High priorities are a GNOME Shell extension for a real native Spotlight
overlay/dock/theme; version-compatible extension packaging; genuine custom
Plymouth/ISO boot images; default keyboard binding strategy; Newelle Flatpak
first-boot provisioning; and Yoga tablet mode.

Source projects remain attributed to Bazzite, Universal Blue and Fedora; the
visible **Mutsu OS** name does not remove upstream dependencies, copyright
or licensing obligations.
