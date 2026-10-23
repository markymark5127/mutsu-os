#!/usr/bin/env bash
# Reproducible staging of the Mutsu OS desktop application for image builds.
# Run from the mutsu-os repository root before "just build".
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Pinned to an audited ai-desktop revision. Bump this SHA deliberately after
# testing changes in the app repo; never pull an unreviewed moving branch.
desktop_commit="9fe8d1c7b958fc96fa472313020cdd5c5729c97b"
desktop_repo="https://github.com/markymark5127/ai-desktop.git"
destination="$repo_root/vendor/ai-desktop"

if [[ -d "$destination/.git" ]]; then
  current="$(git -C "$destination" rev-parse HEAD)"
  if [[ "$current" != "$desktop_commit" ]]; then
    printf >&2 'Found an existing checkout at %s (%s), expected %s.\n' "$destination" "$current" "$desktop_commit"
    printf >&2 'Move it aside yourself before restaging; no local edits were deleted.\n'
    exit 1
  fi
elif [[ -e "$destination" ]]; then
  printf >&2 '%s exists but is not a Git checkout; refusing to overwrite it.\n' "$destination"
  exit 1
else
  mkdir -p "$(dirname "$destination")"
  git clone --filter=blob:none --no-checkout "$desktop_repo" "$destination"
  git -C "$destination" fetch --depth=1 origin "$desktop_commit"
  git -C "$destination" -c advice.detachedHead=false checkout --detach "$desktop_commit"
fi

if [[ "$(git -C "$destination" rev-parse HEAD)" != "$desktop_commit" ]]; then
  printf >&2 'Mutsu desktop revision verification failed.\n'
  exit 1
fi
if [[ ! -f "$destination/src/aidesktop/__main__.py" ]]; then
  printf >&2 'Pinned desktop source is incomplete.\n'
  exit 1
fi

printf 'Staged Mutsu OS Search source at %s\n' "$desktop_commit"
