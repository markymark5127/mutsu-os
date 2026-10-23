# Mutsu OS — Install, Update, and Recovery

This document covers the current state of distribution, installation, updates, and recovery for Mutsu OS. It is **not** a claim that a public beta or signed release exists. See the [roadmap](ROADMAP.md) and open issues for remaining gates.

## Current image status

- OCI images are intended to be built and published to GHCR by the `.github/workflows/build.yml` workflow on trusted `main` pushes (after preflight checks).
- Signing uses Cosign when `SIGNING_SECRET` is configured. Verify repository settings before relying on signatures.
- Disk images / ISOs are generated via the separate `build-disk.yml` workflow and `disk_config/*.toml` blueprints. The legacy `anaconda-iso` path is documented but **not yet proven** with a real install/boot test (tracked in #11).
- No public download page or signed release artifacts are currently published.

## Building and testing locally

```bash
git clone https://github.com/markymark5127/mutsu-os.git
cd mutsu-os
just build          # produces an OCI image (requires Podman)
```

For disk images, follow the Justfile recipes and `disk_config/` notes. Always test in a disposable VM.

## Installing

Until a verified installer is available:

1. Prefer a disposable QEMU/VirtualBox VM.
2. Use the generated qcow2 or ISO only after confirming the workflow produced a bootable artifact.
3. Do **not** rebase a daily-driver machine until M0 gates (especially #8, #11, #13) have attached evidence.

Upstream Bazzite / Universal Blue / Fedora credits and technical IDs are preserved so updates remain compatible.

## Updates and rollback

Mutsu OS is a bootc image. Standard bootc / rpm-ostree patterns apply:

- `bootc upgrade` (or the image's update mechanism) pulls a new deployment.
- `bootc rollback` reverts to the previous deployment.
- User state under `/var` and `/home` is preserved across atomic updates when using the normal bootc layout.

Document any Mutsu-specific overrides here once verified. Fallback to a pure Bazzite rebase remains possible if the Mutsu layer is removed, but test this path before relying on it.

## Recovery

- If GNOME fails to start because of the Adaptive Desktop extension, disable it from a TTY or recovery shell:
  ```bash
  gnome-extensions disable mutsu-adaptive@mutsu-os
  ```
  Or use GNOME Extensions / Settings once a session is available. The extension is **not** enabled by default in the image.
- First-run wizard state lives in `~/.config/ai-desktop/onboarding.json`. Removing or editing it re-triggers the wizard for that user.
- Wallpaper and shortcut defaults are overridable; they do not lock user choices.
- No user API keys or Newelle credentials are baked into the image.

## Release process (planned)

1. Pin and document the exact `ai-desktop` commit and image digest.
2. Attach CI logs, boot screenshots, and rollback evidence to the relevant issues.
3. Require manual approval before publishing any public beta artifacts.
4. Publish SHA256 checksums and clear hardware compatibility notes with any download.
5. Keep Bazzite, Universal Blue, and Fedora attribution visible.

See issue #24 for the full acceptance checklist. This document will be updated when verified artifacts exist.
