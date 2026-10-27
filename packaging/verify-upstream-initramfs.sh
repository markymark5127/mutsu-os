#!/usr/bin/env bash
# Mutsu alpha boot safety: retain the Bazzite/bootc vendor GENERIC initramfs.
#
# Previously we called plain 'dracut -f' from a Containerfile RUN step.
# Dracut's defaults may produce a host-only initramfs for the temporary
# container build environment, excluding virtual disks, Btrfs, and bootc/OSTree
# modules required by installed machines. That is unsafe for a distributable OS.
#
# Custom Plymouth artwork is still packaged in /usr, but do NOT regenerate
# the vendor initramfs just to bake in a splash image before runtime VM tests.
# Preserve a bootable system first; add back the custom splash using bootc's
# recommended generic initramfs configuration after that is verified.
set -euo pipefail

test -s /usr/share/plymouth/themes/mutsu/mutsu-boot-logo.png || {
  echo >&2 'Missing Mutsu Plymouth PNG; installer image is incomplete'
  exit 1
}
test -f /usr/lib64/plymouth/script.so || {
  echo >&2 'Missing script Plymouth plugin'
  exit 1
}

mapfile -t kernels < <(find /usr/lib/modules -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
[[ "${#kernels[@]}" -ge 1 ]] || {
  echo >&2 'No image kernels found; refusing to build a nonbootable Mutsu OS'
  exit 1
}

for kernel in "${kernels[@]}"; do
  img="/usr/lib/modules/$kernel/initramfs.img"
  [[ -s "$img" ]] || {
    echo >&2 "No upstream initramfs for $kernel"
    exit 1
  }
  echo "Preserving upstream initramfs for $kernel (size: $(stat -Lc '%s' "$img") bytes)."
done

echo 'Mutsu Plymouth assets retained; vendor bootc generic initramfs preserved.'
