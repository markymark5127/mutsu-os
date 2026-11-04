# Mutsu OS disk-image builds

## November 4, 2026 — offline ISO image copy error

The Fedora 44 Anaconda generic-ISO builder successfully generated a manifest,
but failed in the final `org.osbuild.skopeo` stage:

```text
Copying this image would require changing layer representation,
which we cannot do: "Destination specifies a digest"
```

The container was selected by its immutable SHA digest as intended, but the
`--bootc-installer-payload-ref` argument also determines the **destination
name** inside the ISO's `containers-storage:` store. A fixed digest cannot
be used as a destination when layer conversion/recompression is needed.

The build now pulls the *same immutable digest*, creates a local,
unpublished `ghcr.io/markymark5127/mutsu-os:offline-installer-payload` tag
with `podman tag`, asserts both image references resolve to the identical
local image ID, then embeds the **tagged alias**. Anaconda's
`--source-imgref containers-storage:` uses that alias for offline installs;
its `--target-imgref` still references the exact published source digest.
The alias is not pushed to GHCR and does not change the payload's contents.

Passing the build is still distinct from boot testing in a blank VM.


## November 4, 2026 — fixing the modern image-builder build

The latest main-branch [failed disk run](https://github.com/markymark5127/mutsu-os/actions/runs/41849282686)
showed two *different* incompatibilities:

- **QCOW2:** `blueprint validation failed for image type "qcow2":
  customizations.filesystem: not supported`. Modern Image Builder expects
  the root filesystem choice on the CLI (`--bootc-default-fs btrfs`), so
  the legacy filesystem customization has been removed from `disk.toml`.
- **ISO:** `image type bootc "anaconda-iso" is not supported with
  image-builder`. A repository override cannot solve that error because
  the modern CLI deliberately does not build legacy Anaconda ISOs.

The pipeline now uses the documented **generic-iso** path. It builds an
independent Fedora 44 Anaconda live installer, embeds the **digest-pinned Mutsu
OS image** in the ISO, and boots with the **Install Mutsu OS** menu entry.
Mutsu's branding is packaged inside the live Anaconda container, rather
than injected later via the old `/images/product.img` mechanism.

Source files: `packaging/installer/Containerfile`,
`packaging/installer/iso.yaml`, `packaging/build-installer-iso.sh`.
Both CI and local `just build-iso` use the same installer script. The
downloadable artifact retains the historical `mutsu-os-anaconda-iso` label
for compatibility with artifact pruning, but its actual image-builder type
is `generic-iso`.

**Safety and verification:** The live installer contains only a `bootc`
interactive-defaults directive and no unattended partitioning instructions.
A successful ISO file build is *not* proof it boots or that installation is
safe on a machine with existing disks. Test only with a blank VM disk before
shipping to physical hardware. This migration also changes the installer
runtime from the previous legacy Anaconda ISO, so graphical QA is required.

Source: https://osbuild.org/docs/developer-guide/projects/image-builder/advanced/bootc/isos/


The Mutsu OS bootc container is built from the Bazzite GNOME base and currently does
**not** advertise a default root filesystem to the image builder.

## Why the ISO/VM job failed

The `Build disk images` workflow previously invoked the legacy
`osbuild/bootc-image-builder-action` without the `rootfs` input. The image
builder stopped during manifest generation with:

```text
error: cannot build manifest: no default root filesystem type specified
in container, please use "--rootfs" to set manually
```

**Fix:** pass `--bootc-default-fs btrfs` when calling image-builder.
The repository's `Justfile` already uses `--rootfs=btrfs` for its manual
`_build-bib` recipe. Both `qcow2` and `anaconda-iso` receive the same setting.
The workflow also defaults PR jobs to the x86_64 runner when no manual
`inputs.platform` is supplied and uses distinct artifact names.

## November 4, 2026: Fedora RPMs missing from legacy ISO depsolve + unknown --force-repo

The real main-branch container build completed, but the `anaconda-iso`
job failed when the legacy bootc-image-builder resolved its **installer**
RPM package set (missing glibc, systemd, etc.). Adding `--force-repo` for the
Fedora 44 Everything + updates repos then failed with:

```text
error: unknown flag: --force-repo
```

The archived `osbuild/bootc-image-builder-action` (and the
`quay.io/centos-bootc/bootc-image-builder` container it runs) does not support
`--force-repo`. That flag exists on the modern `image-builder`.

**Fix:** the workflow now invokes `ghcr.io/osbuild/image-builder-cli:latest`
directly (instead of the old action). For the `anaconda-iso` matrix job only it
still passes the two Fedora 44 RPM repositories with `--force-repo`. Both are
checked for reachable `repodata/repomd.xml` before the expensive build.
The `qcow2` job is intentionally unchanged.

The repo URLs use Fedora 44 because Mutsu is currently based on Fedora 44
through Bazzite GNOME. **When the base moves to Fedora 45 or later, update
the release numbers in both the workflow and the Justfile in the same PR.**
Do not combine RPMs from different Fedora releases. The forced repositories
affect installer build-time depsolving only, not the installed Mutsu system.

The historical failure is recorded in
[Actions run #41771442536](https://github.com/markymark5127/mutsu-os/actions/runs/41771442536).
A successful lint, test suite or QCOW2 build does not prove that a new
Anaconda ISO builds, boots, or asks before installing. Recheck the next
**real main-branch** installer build and test it only in a disposable VM.

Upstream documentation:
- https://osbuild.org/docs/developer-guide/projects/image-builder/advanced/bootc/legacy-isos/
- https://osbuild.org/docs/developer-guide/projects/image-builder/advanced/repositories/

## October 23, 2026: privileged OSBuild mount permission regression

After fixing Btrfs and absolute Podman config paths, both jobs reached OSBuild
but hit mount permission errors on the pinned Ubuntu 26.04 GitHub runner:

```text
qcow2:        mount: /run/osbuild/containers/storage: permission denied (32)
anaconda-iso: mount: /run/osbuild/tree/dev: permission denied (32)
```

The image's OCI build succeeded independently; the errors occur inside the
privileged OSBuild disk-image step. As a targeted compatibility workaround,
the disk-image workflow now pins **Ubuntu 24.04** for both amd64 and arm64,
rather than Ubuntu 26.04 or the moving `ubuntu-latest` label. GitHub documents
pinning 24.04 when incompatible runner changes break existing builds:
https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/

**Verification needed:** a passing QCOW2 and ISO build on the pinned runners,
then a disposable-VM boot check. The runner change is not proof of successful
disk generation; if mount permission errors persist on 24.04, investigate
the builder's mount namespace, AppArmor and privilege handling rather than
adding extra root privileges blindly. Record a confirmed runner/OSBuild
combination before removing this pin.

## Re-run the workflow after merge

1. Merge the image-builder migration after its validation checks pass.
2. Open **Actions → Build disk images → Run workflow** and choose `amd64`.
3. Confirm the generated Podman command contains `--bootc-default-fs btrfs`.
4. Confirm `qcow2` and ISO manifest/build steps finish and download their
   artifacts. This is only an **artifact build**, not a boot test.
5. Boot the QCOW2 in a disposable VM and check GNOME login, Mutsu Search,
   wallpaper, keyboard shortcut, first-run wizard and rollback.

For local builds, use the repo's Just recipes (which already specify
Btrfs) rather than manually running the image-builder command without a
rootfs flag. Note that the Justfile still uses the older bib image; update
it to image-builder-cli if local ISO builds also hit the unknown-flag error.

## Important: unattended legacy installer

The current `anaconda-iso` output is the **legacy unattended Anaconda ISO**.
Depending on builder configuration, it may automatically install to the first
disk. **Do not boot it on a real computer with important disks attached.**
Use only a disposable VM/blank virtual disks until issue #11 replaces it
with a supported, human-confirmed interactive installer and tests
installation behavior.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_disk_image_workflow.py' -v
```

This catches missing/mismatched rootfs flags, incorrect PR architecture
fallbacks and unsupported local workflow assumptions *before* a costly
privileged image build.

## Useful documentation

- [image-builder](https://github.com/osbuild/image-builder)
- [image-builder-action](https://github.com/osbuild/image-builder-action)
- [Legacy ISOs](https://osbuild.org/docs/developer-guide/projects/image-builder/advanced/bootc/legacy-isos/)
- [bootc installation filesystem defaults](https://bootc.dev/bootc/bootc-install.html)

See [Mutsu issue #11](https://github.com/markymark5127/mutsu-os/issues/11).
