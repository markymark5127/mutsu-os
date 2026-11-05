# Mutsu OS — experimental Live USB desktop (manual only)

The **Build Mutsu Live USB ISO (manual)** workflow creates a separate
`mutsu-os-live.iso` that boots directly into the **actual Mutsu GNOME
desktop**, with a temporary, writable in-memory overlay and a live user.
This is **not** the Anaconda installer ISO and does not install Mutsu onto
any internal drive. It lets you inspect the appearance, dock, launcher,
Wi-Fi, and touch behaviour on real hardware before considering installation.

## Build it only when you request it

1. Open [GitHub Actions](https://github.com/markymark5127/mutsu-os/actions/workflows/build-live-iso.yml).
2. Choose **Run workflow**, select `main`, and leave `image_tag=latest`
   to use the most recently published Mutsu OS image.
3. Optionally enter `latest-abcdef0` to use a previously published
   commit-specific Mutsu OS image. It must exist in GHCR.
4. Once the run completes, open its **Artifacts** area and download
   `mutsu-os-live-amd64`. Extract `mutsu-os-live.iso`.

The workflow has only `workflow_dispatch`: no pushes, pull requests,
cron schedules, or dependent workflows can trigger it. Existing Anaconda
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

This manual-only live workflow does **not** run Mutsu's usual installer.
It also does not create a persistent USB installation. The original
`Build disk images` installer-ISO and QCOW2 pipeline is untouched.
