#!/usr/bin/env bash
# Install the Mutsu appearance GNOME Shell extension.
# First-boot enablement is handled by packaging/mutsu-first-boot so we do not
# overwrite Bazzite's enabled-extensions list during the image build.
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

# Stage the first-login branding script and autostart entry.
if [[ -s /tmp/mutsu-first-boot ]]; then
  install -Dm0755 /tmp/mutsu-first-boot /usr/libexec/mutsu-os/mutsu-first-boot
fi
if [[ -s /tmp/mutsu-first-boot.desktop ]]; then
  install -Dm0644 /tmp/mutsu-first-boot.desktop /etc/xdg/autostart/mutsu-first-boot.desktop
fi

echo 'Mutsu Shell branding installed. First login enables Japandi and the Mutsu logo.'
