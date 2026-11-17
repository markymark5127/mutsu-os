# Mutsu OS — experimental Live USB desktop

The **Build Mutsu Live USB ISO** workflow creates a separate
`mutsu-os-live.iso` that boots directly into the **actual Mutsu GNOME
desktop**, with a temporary, writable in-memory overlay and a live user.
This is **not** the Anaconda installer ISO and does not install Mutsu onto
any internal drive. It lets you inspect the appearance, dock, launcher,
Wi-Fi, and touch behaviour on real hardware before considering installation.

## When it is built

Live USBs are only built from a **Beta** image (one that passed the GNOME
runtime check and is signed), never from `latest`.

- **Automatically, with every Beta.** Once the *Beta release* workflow
  publishes a Beta, the same run builds both variants from that Beta's
  permanent tag (`beta-<version>-<date>`). Download `mutsu-os-live-amd64`
  (offline) or `mutsu-os-live-online-amd64` (online) from that run's
  **Artifacts** area. Once both boot tests pass, each ISO is also attached
  to the Beta's public GitHub release as an uncompressed 7-Zip archive split
  into 2000 MiB parts (`mutsu-os-<version>-beta.<date>-live[-online].iso.7z.001`,
  `.002`, …), because GitHub limits release files to 2 GiB. Download every
  part of one variant into one folder and open the `.7z.001` file with
  7-Zip, Keka or `7z x` to get the bootable ISO; compare it with the
  `.iso.sha256` file.
- **On demand.** Open [GitHub Actions](https://github.com/markymark5127/mutsu-os/actions/workflows/build-live-iso.yml),
  choose **Run workflow**, select `main`, and leave `image_tag=beta` for the
  current Beta, or enter `beta-0.1.0-20261113` for an earlier one. It must
  exist in GHCR.

Nothing else triggers it: no pushes, pull requests or cron schedules of its
own. Existing Anaconda
installer and QCOW2 workflows remain separate and unchanged. The source
container is resolved to an immutable SHA-256 digest before building.

The builder is [Tacklebox](https://github.com/tuna-os/tacklebox), pinned to
commit `bbd0b0edeb13363045d7435097761c670d030c88`. Unlike Mutsu's
Anaconda `generic-iso` builder, it creates a squashfs of the Mutsu
desktop, generates a live initramfs, and provides GDM live-user autologin.

## Booting from a USB stick

Use Fedora Media Writer's **Custom Image** mode or a trusted USB image
writer to write `mutsu-os-live.iso` to a 32 GB or larger USB stick.
**Writing the image erases the USB stick.** Choose the USB from the
computer's UEFI boot menu. The live session is ephemeral; changes are
lost when the computer is powered down. It should not repartition or write
to internal drives by itself. Use the existing Anaconda installer ISO for
installation, not this live ISO.

Do not bypass Secure Boot blindly: custom UEFI media may need different
firmware settings. Test with a spare machine/drive first, particularly if
the machine contains important personal data.

## Validation and limitations

The workflow uses `tacklebox verify`, confirms an EFI boot entry,
produces a SHA256 checksum, and attempts a QEMU/OVMF serial boot smoke test.
The QEMU boot test is a **required build gate**. If QEMU cannot confirm a
live login, the job fails rather than publishing a misleading green build.
The ISO and its QEMU log are still uploaded as *diagnostic-only* artifacts
when the ISO assembly succeeded, even if the boot test fails. Inspect
`qemu-live-boot.log` in the artifact to distinguish a kernel/initramfs
failure from an unavailable serial login. A successful ISO build and QEMU
login still do **not** prove that graphics, touchscreen gestures, Wi-Fi, or
Newelle work on real hardware.

This live workflow does **not** run Mutsu's usual installer.
It also does not create a persistent USB installation. The original
`Build disk images` installer-ISO and QCOW2 pipeline is untouched.
