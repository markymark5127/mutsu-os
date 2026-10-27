#!/usr/bin/env bash
# Install Kiwi (is not Apple) system-wide for panel window controls
# that work on maximized windows of any toolkit (GTK, Electron, etc.).
set -euo pipefail
src=/tmp/mutsu-kiwi-src
dest=/usr/share/gnome-shell/extensions/kiwi@kemma

if [[ ! -s "$src/extension.js" || ! -s "$src/metadata.json" ]]; then
  echo >&2 "Missing Kiwi extension source"
  exit 1
fi
install -d -m 0755 "$dest"
cp -a "$src/." "$dest/"
if [[ -d "$dest/schemas" ]]; then
  glib-compile-schemas --strict "$dest/schemas" || true
fi
echo "Kiwi installed system-wide."
