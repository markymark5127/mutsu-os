#!/usr/bin/env bash
# Reproducible staging of the Mutsu OS desktop application for image builds.
# Run from the mutsu-os repository root before "just build".
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Read the single reviewed revision manifest. CI and the installed image
# record these exact references; never fetch an unreviewed moving branch.
source "$repo_root/packaging/desktop-source.env"
desktop_commit="$MUTSU_DESKTOP_COMMIT"
desktop_repo="$MUTSU_DESKTOP_REPO"
if [[ ! "$desktop_commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf >&2 'Invalid 40-character ai-desktop commit in manifest.\n'
  exit 1
fi
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
