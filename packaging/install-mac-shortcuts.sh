#!/usr/bin/env bash
# Install keyd and the Mutsu Mac-style shortcut map.
# keyd is not in Fedora. Build the pinned release, then enable it by
# symlink because the image build has no systemd bus.
set -euo pipefail

KEYD_VERSION=v2.6.0

dnf5 install -y gcc make git

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git clone --depth 1 --branch "$KEYD_VERSION" https://github.com/rvaiya/keyd.git "$src"
make -C "$src"
make -C "$src" install
command -v keyd >/dev/null

install -d -m 0755 /etc/keyd
install -Dm0644 /tmp/mutsu-keyd.conf /etc/keyd/default.conf

unit=/usr/lib/systemd/system/keyd.service
if [[ ! -f "$unit" ]]; then
  echo >&2 "keyd unit not found at $unit"
  exit 1
fi
install -d -m 0755 /etc/systemd/system/multi-user.target.wants
ln -sfn "$unit" /etc/systemd/system/multi-user.target.wants/keyd.service

printf 'Mutsu Mac shortcuts installed from keyd %s. Super+C copy, Super+V paste.\n' "$KEYD_VERSION"
