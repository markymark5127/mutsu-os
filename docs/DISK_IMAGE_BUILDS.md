# Mutsu OS disk-image builds

The Mutsu bootc container is derived from Bazzite GNOME and currently does
**not** advertise a default root filesystem to bootc-image-builder.

## Why the ISO/VM job failed

The `Build disk images` workflow previously invoked the legacy
`osbuild/bootc-image-builder-action` without the `rootfs` input. The image
builder stopped during manifest generation with:

```text
error: cannot build manifest: no default root filesystem type specified
in container, please use "--rootfs" to set manually
```

**Fix:** select `rootfs: btrfs` in
[build-disk.yml](../.github/workflows/build-disk.yml). The repository's
`Justfile` already uses `--rootfs=btrfs` for its manual
`_build-bib` recipe, so local and Actions builds now agree. Both
`qcow2` and `anaconda-iso` in the matrix receive the same setting.
The workflow also defaults PR jobs to the x86_64 runner when no manual
`inputs.platform` is supplied and uses distinct artifact names.

## Re-run the workflow after merge

1. Merge the Btrfs workflow fix after its validation checks pass.
2. Open **Actions → Build disk images → Run workflow** and choose `amd64`.
3. Confirm the generated Podman command contains `--rootfs btrfs` or
   `--rootfs=btrfs` (the exact option formatting is not significant).
4. Confirm `qcow2` and ISO manifest/build steps finish and download their
   artifacts. This is only an **artifact build**, not a boot test.
5. Boot the QCOW2 in a disposable VM and check GNOME login, Mutsu Search,
   wallpaper, keyboard shortcut, first-run wizard and rollback.

For local builds, use the repo's Just recipes (which already specify
Btrfs) rather than manually running the image-builder command without a
rootfs flag.

## Important: unattended legacy installer

The current `anaconda-iso` output is the **legacy unattended Anaconda ISO**.
Depending on builder configuration, it may automatically install to the first
disk. **Do not boot it on a real computer with important disks attached.**
Use only a disposable VM/blank virtual disks until issue #11 replaces it
with a supported, human-confirmed interactive installer and tests
installation behavior.

The pinned `osbuild/bootc-image-builder-action` has been archived and
superseded by `osbuild/image-builder-action`. That migration is a separate
task because the newer action changes inputs, image-builder CLI conventions
and output artifacts; blindly swapping action names would create another
build failure.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_disk_image_workflow.py' -v
```

This catches missing/mismatched `rootfs`, incorrect PR architecture
fallbacks and unsupported local workflow assumptions *before* a costly
privileged image build.

## Useful documentation

- [Legacy action supported `rootfs` input](https://github.com/osbuild/bootc-image-builder-action)
- [Legacy image builder supported filesystem types](https://github.com/osbuild/bootc-image-builder)
- [bootc installation filesystem defaults](https://bootc.dev/bootc/bootc-install.html)

See [Mutsu issue #11](https://github.com/markymark5127/mutsu-os/issues/11).
