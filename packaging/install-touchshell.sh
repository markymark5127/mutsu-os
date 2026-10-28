#!/usr/bin/env bash
# Install Touchshell system-wide. It owns the tablet edge swipes and the
# finger-tracked overview animation. Mutsu Adaptive keeps home locking.
set -euo pipefail
src=/tmp/mutsu-touchshell-src
dest=/usr/share/gnome-shell/extensions/touchshell@touchshell.com

if [[ ! -s "$src/extension.js" || ! -s "$src/metadata.json" ]]; then
  echo >&2 "Missing Touchshell extension source"
  exit 1
fi
install -d -m 0755 "$dest"
cp -a "$src/." "$dest/"
if [[ -d "$dest/schemas" ]]; then
  glib-compile-schemas --strict "$dest/schemas" || true
fi
echo "Touchshell installed system-wide."
