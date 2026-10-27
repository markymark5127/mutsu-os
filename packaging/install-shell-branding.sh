#!/usr/bin/env bash
# Install the system GNOME Shell extension at OS image build time.
# GNOME loads Mutsu from the compiled dconf default BEFORE the first Shell
# session. Do not install any per-user branding autostart or login script.
set -euo pipefail
src=/tmp/mutsu-branding-extension-src
dest=/usr/share/gnome-shell/extensions/mutsu-branding@mutsu-os

if [[ ! -s "$src/extension.js" || ! -s "$src/metadata.json" ]]; then
  echo >&2 "Missing Mutsu GNOME Shell branding extension"
  exit 1
fi
install -d -m 0755 "$dest"
cp -a "$src/." "$dest/"
glib-compile-schemas --strict "$dest/schemas"
test -s "$dest/schemas/gschemas.compiled"

# Clean up any legacy branding login hook from the Bazzite template or
# previous OS image generation. Do not modify user home directories.
rm -f /etc/xdg/autostart/mutsu-first-boot.desktop
rm -f /usr/libexec/mutsu-os/mutsu-first-boot

echo "Mutsu GNOME Shell branding installed system-wide; GNOME reads the compiled defaults."
