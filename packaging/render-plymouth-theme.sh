#!/usr/bin/env bash
# Render the APPROVED Mutsu symbolic SVG to a PNG usable by Plymouth.
# This stages files only. It does NOT install, enable, or regenerate initramfs.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-"$root/output/mutsu-plymouth"}"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo >&2 'Missing rsvg-convert. On Fedora: sudo dnf install librsvg2-tools'
  exit 1
fi
mkdir -p -- "$output"
install -m 0644 "$root/branding/plymouth/mutsu.plymouth" "$output/mutsu.plymouth"
install -m 0644 "$root/branding/plymouth/mutsu.script" "$output/mutsu.script"
rsvg-convert --width=512 --height=512 \
  --output="$output/mutsu-boot-logo.png" \
  "$root/branding/plymouth/mutsu-boot-logo.svg"
test -s "$output/mutsu-boot-logo.png"
echo "Staged Mutsu Plymouth theme at: $output"
echo 'NOT installed or activated. Verify password/unlock UI before configuring as default.'
