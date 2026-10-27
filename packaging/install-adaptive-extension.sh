#!/usr/bin/env bash
# Package Adaptive Desktop as a core Mutsu extension, enabled for fresh users
# by configure-native-desktop.py while preserving vendor extension defaults.
# Run only within the Mutsu OS container image build.
set -euo pipefail

source_dir=/tmp/mutsu-adaptive-src
dest=/usr/share/gnome-shell/extensions/mutsu-adaptive@mutsu-os

if [[ ! -f "$source_dir/extension.js" || ! -f "$source_dir/metadata.json" ]]; then
  echo >&2 "Mutsu Adaptive Desktop extension source is incomplete."
  exit 1
fi

install -d -m 0755 "$dest"
cp -a "$source_dir/." "$dest/"

# GNOME expects this per-extension compiled schema in the extensions' schemas
# folder. Do not suppress schema compilation errors: a malformed extension
# should fail the image build rather than crash the user's GNOME Shell.
if [[ -d "$dest/schemas" ]]; then
  glib-compile-schemas --strict "$dest/schemas"
fi

# Important: this installer does NOT replace the enabled-extensions array.
# configure-native-desktop.py composes the Mutsu defaults with vendor defaults.
# The extension is enabled at first login; hardware auto-detection is still
# unverified, and unsafe bottom-edge interception stays off by default.
# Manual enable: gnome-extensions enable mutsu-adaptive@mutsu-os
# Recovery:    gnome-extensions disable mutsu-adaptive@mutsu-os

# Migrate away from any older template overlay written by a previous Mutsu
# image version. Do NOT remove/replace other GNOME Shell user extension lists.
legacy=/etc/dconf/db/mutsu.d/40-mutsu-adaptive
if [[ -f "$legacy" ]] && grep -Fq 'mutsu-adaptive@mutsu-os' "$legacy"; then
  rm -f "$legacy"
  # dconf databases are generated during the container build. Compile after
  # the deletion, ensuring an older enabled-default cannot survive in the DB.
  dconf update
fi

printf 'Mutsu Adaptive Desktop installed (enabled by native GNOME defaults; gesture interception off).\n'
