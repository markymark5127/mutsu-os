#!/usr/bin/env bash
# Install keyd and the Mutsu Mac-style shortcut map.
# keyd is not in Fedora. Build the pinned release into /usr.
# /usr/local cannot be created on this image, and the build has no
# systemd bus, so enable the unit with a symlink.
set -euo pipefail

KEYD_VERSION=v2.6.0

dnf5 install -y gcc make git

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git clone --depth 1 --branch "$KEYD_VERSION" https://github.com/rvaiya/keyd.git "$src"
make -C "$src" PREFIX=/usr
make -C "$src" install PREFIX=/usr FORCE_SYSTEMD=1
test -x /usr/bin/keyd

install -d -m 0755 /etc/keyd
install -Dm0644 /tmp/mutsu-keyd.conf /etc/keyd/default.conf

unit=/usr/lib/systemd/system/keyd.service
if [[ ! -f "$unit" ]]; then
  echo >&2 "keyd unit not found at $unit"
  exit 1
fi
# Installed but not enabled. The setup wizard applies the user's choice.
# Default is a Windows keyboard; Mac shortcut mapping is opt-in.
printf 'keyd %s installed but not enabled. Setup wizard chooses the profile.\n' "$KEYD_VERSION"
