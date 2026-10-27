# Mutsu OS clean-install acceptance tests (alpha)

## Image provenance

The `Build container image` workflow publishes a digest and the
`latest-<7-character source commit>` tag on success. Disk builds are triggered
by a successful, trusted main-branch container workflow, or manually.

`Build disk images` now resolves that source-specific tag to an immutable OCI
digest **before** running OSBuild. A manual disk build fails rather than
silently using a stale `latest` tag if no image exists for that source SHA.
Pull requests run static disk checks only, not publishable disk builds.

During review, confirm the "Resolve immutable container image" log shows
the same SHA as the container workflow and a `@sha256:` image.

## Fresh-install checklist

On a NEW 60+ GB virtual disk (never use a daily-driver disk):
- [ ] Boot the latest Anaconda ISO in a **UEFI** VM; check the boot menu.
- [ ] Verify Mutsu branding in the live installer, including sidebar/labels.
- [ ] Create an account interactively; finish install, remove ISO, and reboot.
- [ ] Login to GNOME and check `cat /usr/lib/os-release` includes
      `PRETTY_NAME="Mutsu OS"` with base OS compatibility IDs intact.
- [ ] Check Mutsu logo in About and GDM; inspect `journalctl --user -b`
      if branding fails.
- [ ] First GNOME login shows the **Japandi wallpaper, light GNOME
      appearance, sage-accented floating bottom dock, and Mutsu top-bar icon**,
      not a stock desktop. The packaged GNOME 50 extension and
      Fedora Dash-to-Dock must actually enable in the session.
- [ ] Confirm Mutsu appears **at the initial GNOME session**, without
      `~/.config/mutsu-os/first-boot-japandi-v2` or a login-time
      `mutsu-first-boot` launcher. The wallpaper, Shell extensions, dock
      and color preference must come from compiled system defaults.
- [ ] As a fresh account, run `gsettings get org.gnome.shell enabled-extensions`
      and confirm both `mutsu-branding@mutsu-os` and
      `dash-to-dock@micxgx.gmail.com` are listed alongside preserved vendor
      extensions. Check `gsettings get org.gnome.desktop.background picture-uri`
      and `gsettings get org.gnome.desktop.interface color-scheme`.
- [ ] As an upgraded account with its own wallpaper or GNOME extension list,
      confirm the OS update does NOT reset individual preferences. GNOME
      only applies new extension defaults to accounts without a user override.
- [ ] Check `gnome-extensions list --enabled` and
      `gnome-extensions info mutsu-branding@mutsu-os`. The extension
      declares GNOME Shell 46–50; compatibility must still be
      confirmed on a live GNOME 50 session, not just in source metadata.
      Check `gnome-extensions info dash-to-dock@micxgx.gmail.com`
      and that no other dock conflicts or duplicates appear.
- [ ] Open Mutsu Search with Super+Space; complete or skip the one-time wizard.
- [ ] Run `systemctl status mutsu-newelle-preinstall.service`,
      then `flatpak list --system --app | grep -i Newelle`. Internet is
      required on initial boot, and retry occurs on a later boot if offline.
      `flatpak run io.github.qwersyk.Newelle` should launch without a model
      or API key being preconfigured. The OS uses the portable Flatpak install
      command on first successful online boot and writes a marker under
      `/var/lib/mutsu-os/`. An offline first boot retries on the next boot;
      after success, uninstalling Newelle must NOT reinstall it. Check with
      `systemctl cat mutsu-newelle-preinstall.service`.
      Respect explicit uninstall/opt-out.
- [ ] Reboot and confirm the welcome wizard does not return after completion.
- [ ] Verify the image-build log first checks the upstream OSTree
      initramfs, then regenerates a **generic** candidate with explicit
      ostree and Plymouth modules (plus bootc when available). Check that
      ostree-prepare-root and Mutsu Plymouth script/logo were present before
      the candidate replaced the original initramfs.
- [ ] Fresh UEFI VM: verify the **installed OS boots** with the new Mutsu
      Mutsu Plymouth screen and continues into Mutsu GNOME. Confirm
      cold boot, reboot, splash fallback and rollback.
- [ ] **Test disk-encryption unlock** in an encrypted disposable VM; the
      script splash has masked-password and question callbacks but their
      runtime behavior is not yet verified.
- [ ] With the VM powered off, take a checkpoint. Test update and rollback
      from a safe second image deployment.
- [ ] Test BIOS boot and physical USB boot separately before claiming they work.

## Recovery and support

If the GNOME branding extension is incompatible, disable it from a TTY in
the *affected user's* session, or from GNOME Extensions:

```sh
gnome-extensions disable mutsu-branding@mutsu-os
```

The Mutsu branding and dock extensions now load through the **OS-installed
GNOME dconf defaults**, not a first-login hook. The build script preserves
the available upstream enabled-extension list before generating Mutsu's
override. Existing users with a personalized `enabled-extensions` list retain
their choices; use GNOME Extensions to enable Mutsu manually if necessary.

If the Plymouth theme obscures disk-unlock input, use the standard Plymouth
fallback/boot text mode from the boot menu, or roll back to the previous
bootc deployment. **Do not test this first on encrypted production storage.**

The GNOME Adaptive Desktop extension still remains OFF by default. A successful
container image and ISO build alone are not proof of a verified installed OS.

## Relevant sources

- `.github/workflows/build.yml` -> publish signed OCI
- `.github/workflows/build-disk.yml` -> verified digest -> image builder
- `packaging/inject-iso-branding.sh` -> preservative ISO edit plus SHA256
- `packaging/verify-upstream-initramfs.sh` -> validate original vendor
  OSTree initramfs before making changes.
- `packaging/rebuild-mutsu-initramfs.sh` -> compose generic initramfs
  candidate explicitly including `ostree` and Plymouth (and available bootc
  module), verify `ostree-prepare-root` and Mutsu theme assets, then replace.
  **Fresh UEFI VM first boot, encryption unlock, and rollback are still unverified.**
- `packaging/install-newelle.sh` -> one-time Flatpak first-boot service
- `packaging/configure-native-desktop.py` -> image-build-time GNOME extension defaults; no user login hook
