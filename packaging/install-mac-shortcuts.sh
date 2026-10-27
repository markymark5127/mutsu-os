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

systemctl enable keyd.service

printf 'Mutsu Mac shortcuts installed. Super+C copy, Super+V paste, Super+X cut, Super+A select all, Super+Z undo, Super+S save, Super+W close, Super+Q quit, Super+Space search.\n'
