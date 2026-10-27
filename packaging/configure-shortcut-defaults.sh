#!/usr/bin/env bash
# Compile real Mutsu GNOME defaults into the OS image, not user login state.
# Mutsu is first SYSTEM dconf database, preserving Bazzite and custom vendor
# databases after it. GNOME user settings always win; NO dconf locks.
set -euo pipefail

profile=/etc/dconf/profile/user
mkdir -p /etc/dconf/profile
python3 - "$profile" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
entries = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
if not entries:
    entries = ["user-db:user"]
if not entries[0].startswith("user-db:"):
    raise SystemExit("Refusing to replace vendor dconf profile's writable database")
# Preserve the upstream databases and their order; only raise Mutsu's
# system defaults above them. No other system databases are removed.
rest = [line for line in entries[1:] if line != "system-db:mutsu"]
result = [entries[0], "system-db:mutsu", *rest]
path.write_text("\n".join(result) + "\n", encoding="utf-8")
print("Mutsu active dconf profile:", " | ".join(result))
PY

command -v dconf >/dev/null 2>&1 || {
  echo >&2 'dconf is required to compile Mutsu GNOME system defaults'
  exit 1
}
dconf update
