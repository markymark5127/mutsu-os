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
- [ ] Default Japandi background visible. Confirm old user wallpapers aren't
      reset by the one-time Mutsu branding autostart.
- [ ] Check `gnome-extensions list --enabled` and
      `gnome-extensions info mutsu-branding@mutsu-os`. The extension
      currently declares GNOME Shell 46–49; runtime compatibility remains
      subject to testing.
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
- [ ] Confirm the **installed OS boots** using the unmodified generic
      Bazzite initramfs. Do not treat the absence of the new Mutsu logo
      at boot as a failure during this boot-safety test.
- [ ] Inspect `plymouth-set-default-theme` (informational for now).
      **Test disk-encryption unlock** in an encrypted disposable VM; the
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

`packaging/mutsu-first-boot` now fails without marking itself done when the
extension could not be enabled; this allows retry after a corrected image.
It never overwrites the entire `enabled-extensions` list or a user's wallpaper.

If the Plymouth theme obscures disk-unlock input, use the standard Plymouth
fallback/boot text mode from the boot menu, or roll back to the previous
bootc deployment. **Do not test this first on encrypted production storage.**

The GNOME Adaptive Desktop extension still remains OFF by default. A successful
container image and ISO build alone are not proof of a verified installed OS.

## Relevant sources

- `.github/workflows/build.yml` -> publish signed OCI
- `.github/workflows/build-disk.yml` -> verified digest -> image builder
- `packaging/inject-iso-branding.sh` -> preservative ISO edit plus SHA256
- `packaging/verify-upstream-initramfs.sh` -> preserve original generic
  Bazzite bootc initramfs; avoids build-container host-only dracut failures.
  The container build checks with `lsinitrd` for OSTree's
  `ostree-prepare-root` boot hook, preventing ISO publication if the
  chosen initramfs cannot pivot a physical Btrfs root into a deployment.
  The Mutsu Plymouth artwork is staged but its new splash is **not**
  guaranteed to display until a verified generic initramfs integration exists.
- `packaging/install-newelle.sh` -> one-time Flatpak first-boot service
- `packaging/mutsu-first-boot` -> reversible first-login branding
