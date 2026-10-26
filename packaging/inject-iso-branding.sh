#!/usr/bin/env bash
# Inject Anaconda product.img without destroying the original BIOS/EFI/GPT
# boot machinery. Full extraction + mkisofs loses osbuild's hybrid boot flags.
#
# Usage: packaging/inject-iso-branding.sh /path/to/output-directory
# Needs Linux xorriso, cpio, gzip and sha256sum.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${1:?output directory containing the anaconda ISO}"
brand="$root/branding/installer"

for f in sidebar-bg.png sidebar-logo.png topbar-bg.png mutsu.css; do
  [[ -s "$brand/$f" ]] || { echo >&2 "Missing Anaconda branding: $brand/$f"; exit 1; }
done

iso="$(find "$out_dir" -type f -name '*.iso' -print -quit)"
[[ -n "$iso" && -s "$iso" ]] || { echo >&2 "No ISO found under $out_dir"; exit 1; }
echo "Branding ISO (preserving boot metadata): $iso"

work="$(mktemp -d)"
branded="${iso%.iso}-branded.iso"
trap 'rm -rf "$work"; rm -f "$branded"' EXIT

stage="$work/product"
mkdir -p "$stage/usr/share/anaconda/pixmaps" "$stage/usr/share/anaconda"
cp "$brand/sidebar-bg.png" "$brand/sidebar-logo.png" "$brand/topbar-bg.png" \
  "$stage/usr/share/anaconda/pixmaps/"
# Product styling lives in the live installer, not the target bootc image.
cp "$brand/mutsu.css" "$stage/usr/share/anaconda/anaconda-gtk.css"
(
  cd "$stage"
  find . -print | cpio -o -H newc | gzip -9 > "$work/product.img"
)
test -s "$work/product.img"

# Preserve the original boot image paths, hybrid MBR and GPT partitions.
# xorriso's "replay" reuses the loaded ISO's El Torito and System Area
# boot commands rather than guessing BIOS/EFI options from extracted files.
xorriso -indev "$iso" -report_el_torito plain > "$work/boot-before.txt"
grep -Eiq '(UEFI|EFI)' "$work/boot-before.txt" || {
  echo >&2 "Original ISO has no EFI boot entry. Refusing unsafe repack."
  exit 1
}
xorriso -indev "$iso" -outdev "$branded" \
  -map "$work/product.img" /images/product.img \
  -boot_image any replay -commit -end

# Fail closed if the replacement image or boot catalog didn't survive.
xorriso -indev "$branded" -ls /images/product.img >/dev/null
xorriso -indev "$branded" -report_el_torito plain > "$work/boot-after.txt"
grep -Eiq '(UEFI|EFI)' "$work/boot-after.txt" || {
  echo >&2 "Branded ISO lost its EFI boot entry."
  exit 1
}
mv -- "$branded" "$iso"
sha256sum "$iso" > "$iso.sha256"
echo "Preserved ISO BIOS/EFI boot metadata; embedded Mutsu product.img."
echo "SHA256: $(cat "$iso.sha256")"
