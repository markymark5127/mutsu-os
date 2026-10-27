#!/usr/bin/env bash
# Install keyd and the Mutsu Mac-style shortcut map.
# Run only inside the Mutsu image build.
set -euo pipefail

if ! dnf5 install -y keyd; then
  echo >&2 "keyd is not in the enabled repos; Mac shortcuts cannot be installed"
  exit 1
fi

install -d -m 0755 /etc/keyd
install -Dm0644 /tmp/mutsu-keyd.conf /etc/keyd/default.conf

# The image build has no systemd bus, so `systemctl enable` fails with
# "failed to connect to system scope bus". Enable by the same symlink
# systemctl would create.
unit=/usr/lib/systemd/system/keyd.service
if [[ ! -f "$unit" ]]; then
  echo >&2 "keyd unit not found at $unit"
  exit 1
fi
install -d -m 0755 /etc/systemd/system/multi-user.target.wants
ln -sfn "$unit" /etc/systemd/system/multi-user.target.wants/keyd.service

printf 'Mutsu Mac shortcuts installed. Super+C copy, Super+V paste, Super+X cut, Super+A select all, Super+Z undo, Super+S save, Super+W close, Super+Q quit, Super+Space search.\n'
