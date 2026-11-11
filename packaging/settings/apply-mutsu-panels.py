#!/usr/bin/python3
"""Add Mutsu's pages to a GNOME Settings (gnome-control-center) source tree.

    apply-mutsu-panels.py <gnome-control-center source dir>

Edits by anchor rather than by line numbers, so it keeps applying as GNOME
Settings moves between point releases. Fails loudly if an anchor is gone.
Panels added (each a folder next to this script):

    mutsu-updates   Software Updates (in the System section, above System)
    mutsu-search    Mutsu Search (just above GNOME's own Search page)
"""

import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PANELS = [
    # (id, C type prefix, place it before this panel id in the sidebar)
    ("mutsu-updates", "cc_mutsu_updates_panel", "system"),
    ("mutsu-search", "cc_mutsu_search_panel", "search"),
]


def edit(path: Path, transform) -> None:
    text = path.read_text(encoding="utf-8")
    new = transform(text)
    if new == text:
        raise SystemExit(f"apply-mutsu-panels: nothing changed in {path}")
    path.write_text(new, encoding="utf-8")


def main(source: str) -> None:
    root = Path(source)
    for panel_id, prefix, before in PANELS:
        target = root / "panels" / panel_id
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(HERE / panel_id, target)

        def add_to_meson(text, panel_id=panel_id):
            if f"'{panel_id}'" in text:
                return text + "\n"
            new, n = re.subn(r"(^panels = \[\n)", rf"\1  '{panel_id}',\n", text, count=1, flags=re.M)
            if not n:
                raise SystemExit("apply-mutsu-panels: panels/meson.build has no 'panels = [' list")
            return new
        edit(root / "panels" / "meson.build", add_to_meson)

        def add_to_loader(text, panel_id=panel_id, prefix=prefix):
            if f'"{panel_id}"' in text:
                return text + "\n"
            new, n1 = re.subn(r"(extern GType cc_applications_panel_get_type \(void\);\n)",
                              rf"\1extern GType {prefix}_get_type (void);\n", text, count=1)
            new, n2 = re.subn(r'(\n(\s*)PANEL_TYPE \("applications",[^\n]*\n)',
                              rf'\1\2PANEL_TYPE ("{panel_id}", {prefix}_get_type, NULL),\n', new, count=1)
            if not (n1 and n2):
                raise SystemExit("apply-mutsu-panels: shell/cc-panel-loader.c anchors not found")
            return new
        edit(root / "shell" / "cc-panel-loader.c", add_to_loader)

        def add_to_order(text, panel_id=panel_id, before=before):
            if f'"{panel_id}",' in text:
                return text + "\n"
            new, n = re.subn(rf'(\n(\s*)"{before}",\n)', rf'\n\2"{panel_id}",\1', text, count=1)
            if not n:
                raise SystemExit(f'apply-mutsu-panels: "{before}" not in the sidebar order')
            return new
        edit(root / "shell" / "cc-panel-list.c", add_to_order)
    print("apply-mutsu-panels: added " + ", ".join(p[0] for p in PANELS))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
