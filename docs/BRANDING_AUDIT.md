# Mutsu OS — user-visible branding acceptance checklist

This checklist concerns **product-facing identity**, not upstream attribution.
Mutsu derives from Bazzite/Fedora and MUST retain compatible technical IDs,
package names, RPMs, signatures, image references, OSBuild/bootc/OSTree state
and third-party project names.

## Image build coverage

The `Containerfile` now installs Mutsu branding and runs:
`packaging/verify-visible-branding.py`. This is a fail-closed source/image
assertion for the following:

- `NAME` and `PRETTY_NAME` show **Mutsu OS** while `ID`, `VERSION_ID` and
  `ID_LIKE` remain compatible with the Bazzite GNOME base.
- Bash and Fish aliases, Fastfetch assets, MOTD banners, and MOTD tips use
  Mutsu identity.
- The inherited `/etc/skel/.config/autostart/bazzite-portal.desktop` is
  removed for **new accounts**; Bazzite announcements are disabled through
  the system autostart entry.
- Bazzite/Fedora-titled wallpaper entries are removed from GNOME's picker
  metadata, but wallpaper assets are not deleted.
- Hidden upstream utilities may keep technical names and paths. Visible
  system .desktop entries may not use upstream product labels.
- The Mutsu updater app uses a new branded launcher. It still executes the
  vendor-maintained `ujust update` recipe, avoiding custom update logic.
- `ujust changelogs` fetches **Mutsu's** repository release notes, not
  Bazzite's. A lack of published releases is reported explicitly.
- Anaconda's ISO `product.img` includes `branding/installer/.buildstamp`;
  installer product identity is **Mutsu OS**.
- `GRUB_DISTRIBUTOR` is **Mutsu OS** where `/etc/default/grub` exists;
  `PRETTY_NAME` is used for managed OSTree boot entries.

## Mandatory visual testing (NOT proven by static checks)

On a disposable VM with a fresh install and a *new* local account:

1. Inspect the **ISO boot menu**, Anaconda welcome screen, target install
   confirmation, and final result. Look for Fedora/Bazzite/Fedora 44 labels.
2. Reboot, inspect every visible **GRUB / BLS / rollback entry** and the
   **Plymouth** splash. Do not manually rewrite generated entries or EFI
   variables; an unsafe edit may make the machine unbootable.
3. Inspect **GDM login**, GNOME top bar, dock, app grid, **About**,
   **Software Sources**, and desktop background chooser for inherited names.
4. Open terminal (Bash and Fish): inspect startup banner and rotating tips,
   then run `fastfetch`, `hostnamectl`, `cat /etc/os-release`,
   `ujust --choose`, and `ujust changelogs`. Machine fields such as
   `ID=bazzite` and `VERSION_ID=44` are **expected** technical values.
5. Open **Mutsu Updater** and **Mutsu Portal**, verify visible titles
   and update controls; confirm update status and rollback still function.
6. Verify the new account never autostarts a Bazzite welcome or announcement.
7. For a previously created account, run `mutsu-branding-doctor`
   (read-only). To back up and disable only known inherited user autostart
   entries and Fastfetch config, and disable the old logo-menu extension,
   explicitly run `mutsu-branding-doctor --fix`. No automatic per-login
   home-directory changes are made.
8. Test a **previously created** account separately. Existing `~/.config`
   autostart entries, dconf values, shell aliases, or custom hostnames
   are deliberately **not overwritten** by the image build.
9. Test that the Mutsu branding persists across a bootc update, and that
   an older rollback deployment behaves consistently.

For deeper read-only diagnostics:

```bash
printf '\n--- Image identity ---\n'
grep -E '^(ID|ID_LIKE|VERSION_ID|NAME|PRETTY_NAME|LOGO)=' /etc/os-release
printf '\n--- Boot titles ---\n'
grep -H '^title ' /boot/loader/entries/*.conf 2>/dev/null || true
printf '\n--- User startup ---\n'
grep -RHiE 'bazzite|fedora' ~/.config/autostart /etc/xdg/autostart 2>/dev/null || true
printf '\n--- Shell and image ---\n'
hostnamectl
fastfetch
```

## Known limitations

- ISO bootloader menu text cannot be reliably rewritten from the payload's
  source alone. Confirm the actual ISO's bootloader config before changing it.
  Mutsu's `product.img` and the installed OS are separate images.
- Existing user-specific overrides are preserved rather than silently erased.
- Third-party packages (e.g., `Bazzite Buddy`) retain their actual name.
- Debug logs, kernel/package details, `rpm -q`, `bootc status` and some
  vendor update output may legitimately reference Bazzite/Fedora. This is not
  a visual-branding failure and must not be hidden from diagnostics.
- Passing the repository tests does **not** certify boot, ISO installation,
  a running GNOME session, graphics, update or rollback correctness.
