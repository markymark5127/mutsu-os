#!/usr/bin/env python3
"""Build Mutsu's look into GNOME Shell's own theme.

GNOME Shell reads its stylesheet from gnome-shell-theme.gresource before
anything else runs, so CSS added there is in place from the first frame of
the login screen, the lock screen and the session. (Loaded from an
extension, the same CSS only arrives after login, visibly.)

    bake-shell-theme.py <gnome-shell-theme.gresource> <out.gresource> <css>...

Appends the given CSS files to every gnome-shell*.css in the resource except
the high-contrast one, which stays GNOME's. "file.css::text" takes only the
part of file.css from the line starting with `text` to the end (used for the
sage accent block of the tablet-mode stylesheet). Needs `gresource` and
`glib-compile-resources` (glib2-devel).
"""
import subprocess
import sys
import tempfile
from pathlib import Path

PREFIX = "/org/gnome/shell/theme/"
MARK = "/* ==== Mutsu OS (built in) ==== */"


def read_css(spec: str) -> str:
    path, _, marker = spec.partition("::")
    text = Path(path).read_text()
    if not marker:
        return text
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith(marker):
            return "".join(lines[i:])
    sys.exit(f"bake-shell-theme: {marker!r} not found in {path}")


def main(source: str, target: str, css_files: list[str]) -> None:
    extra = "\n".join(read_css(f) for f in css_files)
    resources = subprocess.run(["gresource", "list", source], check=True,
                               capture_output=True, text=True).stdout.split()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        patched = []
        for res in resources:
            data = subprocess.run(["gresource", "extract", source, res],
                                  check=True, capture_output=True).stdout
            name = res[len(PREFIX):] if res.startswith(PREFIX) else None
            if name and "/" not in name and name.startswith("gnome-shell") \
                    and name.endswith(".css") and "high-contrast" not in name:
                text = data.decode()
                if MARK not in text:
                    text += f"\n\n{MARK}\n{extra}\n"
                data = text.encode()
                patched.append(name)
            path = root / res.lstrip("/")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if not patched:
            sys.exit("bake-shell-theme: no gnome-shell*.css found in the theme")
        files = "\n".join(f'    <file>{r[len(PREFIX):]}</file>' for r in resources if r.startswith(PREFIX))
        others = [r for r in resources if not r.startswith(PREFIX)]
        if others:
            sys.exit(f"bake-shell-theme: unexpected resources outside {PREFIX}: {others}")
        xml = root / "theme.gresource.xml"
        xml.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<gresources>\n'
                       f'  <gresource prefix="{PREFIX.rstrip("/")}">\n{files}\n  </gresource>\n</gresources>\n')
        subprocess.run(["glib-compile-resources", f"--sourcedir={root / PREFIX.strip('/')}",
                        f"--target={target}", str(xml)], check=True)
    print(f"bake-shell-theme: Mutsu's look built into {', '.join(patched)}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
