#!/usr/bin/env bash
# Make Mutsu the boot splash without producing a host-only initramfs.
#
# Plymouth reads its theme from the initramfs. Leaving Bazzite's initramfs
# in place keeps the Bazzite logo on the "preparing system" screen.
# A plain `dracut -f` can make a host-only image that cannot see the target
# disk. Always rebuild generic, then refuse the image if OSTree prep is gone.
set -euo pipefail

theme=/usr/share/plymouth/themes/mutsu
[[ -s "$theme/mutsu.plymouth" && -s "$theme/mutsu.script" && -s "$theme/mutsu-boot-logo.png" ]] || {
  echo >&2 "Mutsu Plymouth theme is incomplete"
  exit 1
}
[[ -f /usr/lib64/plymouth/script.so ]] || {
  echo >&2 "Missing plymouth-plugin-script"
  exit 1
}

install -d -m 0755 /etc/plymouth
cat > /etc/plymouth/plymouthd.conf <<'EOF'
[Daemon]
Theme=mutsu
ShowDelay=0
EOF

if command -v plymouth-set-default-theme >/dev/null; then
  plymouth-set-default-theme mutsu || true
fi

mapfile -t kernels < <(find /usr/lib/modules -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
[[ "${#kernels[@]}" -ge 1 ]] || {
  echo >&2 "No image kernels found"
  exit 1
}

command -v lsinitrd >/dev/null || {
  echo >&2 "lsinitrd missing"
  exit 1
}

for kernel in "${kernels[@]}"; do
  img="/usr/lib/modules/$kernel/initramfs.img"
  [[ -s "$img" ]] || {
    echo >&2 "No upstream initramfs for $kernel"
    exit 1
  }
  echo "Rebuilding generic Mutsu initramfs for $kernel"
  dracut --force --no-hostonly --kver "$kernel" "$img"
  [[ -s "$img" ]] || {
    echo >&2 "dracut produced an empty initramfs for $kernel"
    exit 1
  }
  if ! lsinitrd "$img" | grep -E 'ostree-prepare-root' >/dev/null; then
    echo >&2 "FATAL: rebuilt $img is missing ostree-prepare-root"
    exit 1
  fi
  if ! lsinitrd "$img" | grep -E 'plymouth/themes/mutsu' >/dev/null; then
    echo >&2 "FATAL: rebuilt $img does not contain the Mutsu Plymouth theme"
    exit 1
  fi
  echo "Mutsu splash embedded for $kernel"
done
