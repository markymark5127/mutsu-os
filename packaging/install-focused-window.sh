#!/usr/bin/env bash
set -euo pipefail
src=/tmp/mutsu-focused-window-src
dest=/usr/share/gnome-shell/extensions/focused-window-dbus@flexagoon.com
install -d -m0755 "$dest"
cp -a "$src/." "$dest/"
test -s "$dest/metadata.json"
echo "Focused Window D-Bus installed for Toshy."
