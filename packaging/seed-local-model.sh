#!/usr/bin/env bash
# Runs as root via the unit's "+" prefix. The service user cannot read
# Ollama's owner-only metadata files in /usr. Copy without those modes.
set -euo pipefail
source=/usr/share/mutsu-os/local-ai
state="${STATE_DIRECTORY:-/var/lib/mutsu-ollama}"
receipt="$(sha256sum "$source/source.env" | cut -d' ' -f1)"
# systemd has already handed the state directory to the service's dynamic
# user. Everything copied here as root must belong to that user too: Ollama
# writes and removes files under models/ (its manifest migration failed
# with "permission denied" and the service never started).
# With DynamicUser, /var/lib/mutsu-ollama is a root-owned symlink to
# /var/lib/private/mutsu-ollama: follow it (-L), or this reads root and
# "fixes" the files to root again.
owner="$(stat -L -c %u:%g "$state")"
if [[ "${owner%%:*}" == "0" ]]; then
  echo "seed-local-model: state directory is owned by root; refusing to guess the service user" >&2
fi
fix_owner() {
  if [[ -d "$state/models" && -n "$(find "$state/models" ! -user "${owner%%:*}" -print -quit)" ]]; then
    chown -R "$owner" "$state/models"
  fi
}
if [[ -s "$state/.seeded" && "$(cat "$state/.seeded")" == "$receipt" ]]; then
  fix_owner
  exit 0
fi
mkdir -p "$state/models"
cp -r --reflink=auto "$source/models/." "$state/models/"
chmod -R u+rwX,go+rX "$state/models"
chown -R "$owner" "$state/models"
printf '%s\n' "$receipt" > "$state/.seeded"
chmod 0644 "$state/.seeded"
