#!/usr/bin/env bash
# Install, but DO NOT automatically enable, the experimental Adaptive Desktop
# extension. GNOME/Bazzite's existing enabled extensions must be preserved.
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

# Important: no '/org/gnome/shell/ enabled-extensions' default is written here.
# That GSettings list is a replacement, not additive, and overwriting it can
# disable Bazzite/third-party extensions. Keep this unverified experimental
# Shell extension OFF until it passes actual GNOME and tablet-device testing.
# Test opt-in: gnome-extensions enable mutsu-adaptive@mutsu-os
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

printf 'Mutsu Adaptive Desktop installed (not enabled; opt in after GNOME QA).\n'
