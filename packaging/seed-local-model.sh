#!/usr/bin/env bash
# Runs as root via the unit's "+" prefix. The service user cannot read
# Ollama's owner-only metadata files in /usr. Copy without those modes.
set -euo pipefail
source=/usr/share/mutsu-os/local-ai
state="${STATE_DIRECTORY:-/var/lib/mutsu-ollama}"
receipt="$(sha256sum "$source/source.env" | cut -d' ' -f1)"
if [[ -s "$state/.seeded" && "$(cat "$state/.seeded")" == "$receipt" ]]; then
  exit 0
fi
mkdir -p "$state/models"
cp -r --reflink=auto "$source/models/." "$state/models/"
chmod -R u+rwX,go+rX "$state/models"
printf '%s\n' "$receipt" > "$state/.seeded"
chmod 0644 "$state/.seeded"
