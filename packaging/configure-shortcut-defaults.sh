#!/usr/bin/env bash
# Register user-overridable GNOME defaults in an image build. No key locks.
set -euo pipefail
profile=/etc/dconf/profile/user

if [[ ! -e "$profile" ]]; then
  mkdir -p /etc/dconf/profile
  printf 'user-db:user\n' > "$profile"
fi

if ! grep -Fxq 'system-db:mutsu' "$profile"; then
  printf 'system-db:mutsu\n' >> "$profile"
fi

if ! command -v dconf >/dev/null 2>&1; then
  echo >&2 'dconf is required to compile Mutsu OS GNOME defaults.'
  exit 1
fi

dconf update
