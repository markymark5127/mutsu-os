#!/usr/bin/env bash
# Build a Mutsu product.img and inject it into an Anaconda ISO so the live
# installer loads the sage sidebar instead of the stock Fedora banner.
#
# Usage:
#   packaging/inject-iso-branding.sh /path/to/output-directory
#
# Requires: xorriso, cpio, gzip, find. Run on Linux.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${1:?output directory containing the anaconda-iso}"
brand="$root/branding/installer"

for f in sidebar-bg.png sidebar-logo.png topbar-bg.png mutsu.css; do
  if [[ ! -s "$brand/$f" ]]; then
    echo >&2 "Missing installer branding file: $brand/$f"
    exit 1
  fi
done

iso=$(find "$out_dir" -type f -name '*.iso' | head -n 1)
if [[ -z "${iso:-}" ]]; then
  echo >&2 "No .iso found under $out_dir"
  exit 1
fi
echo "Branding ISO: $iso"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stage="$work/product"
extract="$work/iso"
mkdir -p "$stage/usr/share/anaconda/pixmaps" "$extract"

cp "$brand/sidebar-bg.png" "$brand/sidebar-logo.png" "$brand/topbar-bg.png" \
  "$stage/usr/share/anaconda/pixmaps/"
# Anaconda loads this exact filename from the installer runtime.
cp "$brand/mutsu.css" "$stage/usr/share/anaconda/anaconda-gtk.css"

(
  cd "$stage"
  find . | cpio -o -H newc | gzip -9 > "$work/product.img"
)
test -s "$work/product.img"
echo "Built product.img ($(wc -c < "$work/product.img") bytes)"

# Extract without mounting so this works on a GitHub runner.
xorriso -osirrox on -indev "$iso" -extract / "$extract"
mkdir -p "$extract/images"
cp "$work/product.img" "$extract/images/product.img"

# Detect the BIOS/UEFI boot files Anaconda ISOs usually ship.
bios_bin=""
efi_img=""
[[ -f "$extract/isolinux/isolinux.bin" ]] && bios_bin="isolinux/isolinux.bin"
[[ -f "$extract/images/efiboot.img" ]] && efi_img="images/efiboot.img"
[[ -z "$efi_img" && -f "$extract/images/efiboot.img" ]] || true

if [[ -z "$bios_bin" && -z "$efi_img" ]]; then
  echo >&2 "Could not find isolinux.bin or efiboot.img; ISO layout is unexpected"
  find "$extract" -maxdepth 3 -type f | head -n 40 >&2
  exit 1
fi

branded="${iso%.iso}-branded.iso"
cmd=(xorriso -as mkisofs -o "$branded" -V MUTSU_OS -J -r)
if [[ -n "$bios_bin" ]]; then
  cmd+=(
    -b "$bios_bin"
    -c isolinux/boot.cat
    -no-emul-boot -boot-load-size 4 -boot-info-table
  )
fi
if [[ -n "$efi_img" ]]; then
  cmd+=(-eltorito-alt-boot -e "$efi_img" -no-emul-boot)
fi
cmd+=("$extract")
"${cmd[@]}"

# Replace the original artifact with the branded ISO.
mv "$branded" "$iso"
echo "Injected Mutsu product.img into $iso"
