#!/usr/bin/env bash
# Install the Mutsu Adaptive Desktop GNOME Shell extension into the image.
# Run only during image build.
set -euo pipefail

if [[ ! -d /tmp/mutsu-adaptive-src ]]; then
  echo >&2 "Adaptive extension source not staged."
  exit 1
fi

dest=/usr/share/gnome-shell/extensions/mutsu-adaptive@mutsu-os
install -d -m 0755 "$dest"
cp -a /tmp/mutsu-adaptive-src/. "$dest/"

# Compile schemas if present
if [[ -d "$dest/schemas" ]]; then
  glib-compile-schemas "$dest/schemas" || true
fi

# Enable for new users via a system dconf default (overridable)
install -d -m 0755 /etc/dconf/db/mutsu.d
cat > /etc/dconf/db/mutsu.d/40-mutsu-adaptive <<'DCONF'
[org/gnome/shell]
enabled-extensions=['mutsu-adaptive@mutsu-os']
DCONF

printf 'Mutsu Adaptive Desktop extension installed.\n'
