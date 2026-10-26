#!/usr/bin/env bash
# Install the *disabled-by-default* Mutsu appearance GNOME Shell extension.
# Run ONLY inside the Mutsu OS image build container.
set -euo pipefail
src=/tmp/mutsu-branding-extension-src
dest=/usr/share/gnome-shell/extensions/mutsu-branding@mutsu-os

if [[ ! -s "$src/extension.js" || ! -s "$src/metadata.json" ]]; then
  echo >&2 'Missing Mutsu Shell branding extension source'
  exit 1
fi
install -d -m 0755 "$dest"
cp -a "$src"/. "$dest"/
glib-compile-schemas --strict "$dest/schemas"
# No dconf enabled-extensions or locked appearance setting is modified.
echo 'Mutsu Shell branding extension installed (disabled by default).'
