#!/usr/bin/env bash
# Deliberately delegates to the vendor-maintained update workflow.
# No rebase, rpm replacement or update-transaction interception.
set -uo pipefail

printf '\n    Mutsu OS Updates\n    ────────────────\n\n'
if command -v ujust >/dev/null 2>&1; then
  ujust update
  result=$?
else
  printf 'ujust is unavailable. Running bootc upgrade instead.\n\n'
  bootc upgrade
  result=$?
fi
printf '\n'
if (( result == 0 )); then
  printf 'Mutsu OS update command finished. A restart may be required.\n'
else
  printf 'Mutsu OS update command failed (exit %s). Review the output above.\n' "$result"
fi
if [[ -t 0 ]]; then
  printf 'Press Enter to close this window... '
  IFS= read -r _ || true
fi
exit "$result"
