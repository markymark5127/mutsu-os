#!/usr/bin/env bash
# Runs as the model service's dynamic user. Reflinks avoid a second data copy
# where the filesystem supports them; extra user-added models are retained.
set -euo pipefail
source=/usr/share/mutsu-os/local-ai
state="${STATE_DIRECTORY:-/var/lib/mutsu-ollama}"
receipt="$(sha256sum "$source/source.env" | cut -d' ' -f1)"
if [[ -s "$state/.seeded" && "$(cat "$state/.seeded")" == "$receipt" ]]; then
  exit 0
fi
mkdir -p "$state/models"
cp -r --preserve=mode,timestamps --reflink=auto "$source/models/." "$state/models/"
printf '%s\n' "$receipt" > "$state/.seeded"
