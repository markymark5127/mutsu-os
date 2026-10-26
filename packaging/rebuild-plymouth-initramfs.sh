#!/usr/bin/env bash
# Run only in the immutable Mutsu image build, AFTER every package is installed.
# Never regenerate /boot on an already installed bootc/rpm-ostree machine.
set -euo pipefail

[[ -f /usr/lib64/plymouth/script.so ]] || {
  echo >&2 'Missing plymouth-plugin-script; cannot enable Mutsu boot splash'
  exit 1
}
[[ -s /usr/share/plymouth/themes/mutsu/mutsu-boot-logo.png ]] || {
  echo >&2 'Missing Mutsu boot-splash PNG'
  exit 1
}
command -v dracut >/dev/null || { echo >&2 'dracut missing in base image'; exit 1; }
command -v plymouth-set-default-theme >/dev/null || { echo >&2 'Plymouth theme command missing'; exit 1; }

# Selecting the theme MUST NOT use -R: that regenerates an initramfs for the
# build runner's kernel. Rebuild explicitly for the image's own kernel below.
plymouth-set-default-theme mutsu
selected="$(plymouth-set-default-theme)"
[[ "$selected" == "mutsu" ]] || {
  echo >&2 "Plymouth selection failed: $selected"
  exit 1
}

mapfile -t kernels < <(find /usr/lib/modules -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
[[ "${#kernels[@]}" -eq 1 ]] || {
  printf >&2 'Expected exactly one bootc image kernel; got %s\n' "${#kernels[@]}"
  exit 1
}
kernel="${kernels[0]}"
echo "Rebuilding the Mutsu initramfs for image kernel: $kernel"
DRACUT_NO_XATTR=1 dracut -f "/usr/lib/modules/$kernel/initramfs.img" "$kernel"
test -s "/usr/lib/modules/$kernel/initramfs.img"
echo "Mutsu Plymouth theme embedded into image-kernel initramfs."
