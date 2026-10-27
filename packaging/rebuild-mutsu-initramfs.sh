#!/usr/bin/env bash
# Build-time ONLY: add Mutsu Plymouth to a generic bootc/OSTree initramfs.
# Retain the vendor initramfs until the candidate passes ALL checks.
# Never run on a live user's OS: deploy a tested OCI image instead.
set -euo pipefail

command -v dracut >/dev/null
command -v lsinitrd >/dev/null
command -v plymouth-set-default-theme >/dev/null
test -s /usr/share/plymouth/themes/mutsu/mutsu-boot-logo.png
test -f /usr/share/plymouth/themes/mutsu/mutsu.script
test -f /usr/lib64/plymouth/script.so

# OSTree is opt-in in generic dracut builds. Dropping this module caused
# the earlier Mutsu first-boot emergency shell.
modules="$(dracut --list-modules)"
grep -Eq '^[[:space:]]*ostree[[:space:]]*$' <<< "$modules" || {
  echo >&2 'FATAL: no ostree dracut module; refusing to replace vendor initramfs'
  exit 1
}
grep -Eq '^[[:space:]]*plymouth[[:space:]]*$' <<< "$modules" || {
  echo >&2 'FATAL: no plymouth dracut module'
  exit 1
}

add_modules="ostree plymouth"
# Some newer bootc/composefs images require an opt-in bootc module as well.
if grep -Eq '^[[:space:]]*bootc[[:space:]]*$' <<< "$modules"; then
  add_modules+=" bootc"
fi

# The atomic base often has /root -> /var/roothome, where the target does
# not exist in the build container. dracut-install then errors on /root.
# Temporarily substitute a real build-only /root and restore the symlink.
saved_root=""
restore_root() {
  if [[ -n "$saved_root" ]]; then
    rm -rf -- /root
    mv -- "$saved_root" /root
    saved_root=""
  fi
}
trap restore_root EXIT
if [[ -L /root && ! -d /root ]]; then
  saved_root="/root.mutsu-dracut-original.$$"
  mv -- /root "$saved_root"
  install -d -m 0700 /root
fi

plymouth-set-default-theme mutsu
[[ "$(plymouth-set-default-theme)" == "mutsu" ]] || {
  echo >&2 'Mutsu Plymouth theme was not selected'
  exit 1
}

mapfile -t kernels < <(find /usr/lib/modules -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
[[ "${#kernels[@]}" -eq 1 ]] || {
  echo >&2 'Expected exactly one bootc image kernel'
  exit 1
}
for kver in "${kernels[@]}"; do
  img="/usr/lib/modules/$kver/initramfs.img"
  candidate="${img}.mutsu-candidate"
  [[ -s "$img" ]] || { echo >&2 "Missing vendor initramfs: $img"; exit 1; }
  rm -f -- "$candidate" "$candidate.list" "$candidate.vendor-list"
  trap 'rm -f -- "$candidate" "$candidate.list" "$candidate.vendor-list"; restore_root' EXIT

  # Generic: don't specialize to the temporary CI container's hardware or cmdline.
  env DRACUT_NO_XATTR=1 dracut --force --no-hostonly --no-hostonly-cmdline \
    --add "$add_modules" "$candidate" "$kver"
  [[ -s "$candidate" ]] || { echo >&2 'dracut produced no image'; exit 1; }

  # Save the complete inventory to avoid grep -q SIGPIPE under pipefail.
  lsinitrd "$candidate" > "$candidate.list"
  lsinitrd "$img" > "$candidate.vendor-list"
  # Fail closed: the previous failure came from a missing OSTree root pivot.
  for required in ostree-prepare-root mutsu.script mutsu-boot-logo.png; do
    grep -Fq "$required" "$candidate.list" || {
      echo >&2 "FATAL: rebuilt initramfs lacks $required"
      exit 1
    }
  done

  # Preserve bootc/composefs boot support if the vendor image included it.
  if grep -Fq bootc-root-setup.service "$candidate.vendor-list"; then
    grep -Fq bootc-root-setup.service "$candidate.list" || {
      echo >&2 'FATAL: rebuilt initramfs lost bootc root setup'
      exit 1
    }
  fi

  mv -f -- "$candidate" "$img"
  rm -f -- "$candidate.list" "$candidate.vendor-list"
  echo "Mutsu Plymouth embedded in generic OSTree-safe initramfs for $kver."
done
trap - EXIT
restore_root
