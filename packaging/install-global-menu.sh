#!/usr/bin/env bash
# Install Global Menu for GNOME system-wide so Mutsu gets a Mac-style
# File / Edit / View / Window menu bar next to the Mutsu logo.
set -euo pipefail
src=/tmp/mutsu-global-menu-src
dest=/usr/share/gnome-shell/extensions/globalmenu@ShiroOSL.github.io

if [[ ! -s "$src/extension.js" || ! -s "$src/metadata.json" ]]; then
  echo >&2 "Missing Global Menu for GNOME extension source"
  exit 1
fi
install -d -m 0755 "$dest"
cp -a "$src/." "$dest/"
if [[ -d "$dest/schemas" ]]; then
  glib-compile-schemas --strict "$dest/schemas"
  test -s "$dest/schemas/gschemas.compiled"
fi
echo "Global Menu for GNOME installed system-wide."
