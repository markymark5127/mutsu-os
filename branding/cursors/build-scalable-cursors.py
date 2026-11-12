#!/usr/bin/env python3
"""Give a cursor theme the SVG ("cursors_scalable") cursors GNOME 51 reads.

Usage: build-scalable-cursors.py THEME_DIR ARROW.svg HOT_X HOT_Y [NOMINAL]

GNOME Shell 51 draws the pointer itself (St) and loads
<theme>/cursors_scalable/<name>/metadata.json plus the SVG it names; the
older Xcursor files in <theme>/cursors are only used by Xwayland apps. With
no cursors_scalable folder, the Shell logged "Could not load cursor
'default'" and fell back to its built-in Adwaita arrow, so the login screen
and Shell showed GNOME's pointer instead of Mutsu's.

This writes:
  default/      Mutsu's arrow (ARROW.svg, hotspot HOT_X,HOT_Y in SVG pixels;
                NOMINAL is the cursor size the drawing is meant for: 32
                keeps it the same size as the Xcursor version)
  every other   copied from the Adwaita SVG cursors built into GNOME Shell
  name          (resource:///org/gnome/shell/cursor-theme/), so nothing falls
                back and nothing is logged as missing.
"""
import json
import sys
from pathlib import Path

RESOURCE_ROOT = '/org/gnome/shell/cursor-theme/icons/Adwaita/cursors_scalable/'
MAGIC = b'GVariant\x00\x00\x00\x00'


def shell_cursor_resource():
    """The GResource built into GNOME Shell's St library, or None."""
    try:
        from gi.repository import Gio, GLib
    except ImportError:
        return None
    for lib in sorted(Path('/usr/lib64/gnome-shell').glob('libst-*.so')) + \
            sorted(Path('/usr/lib/gnome-shell').glob('libst-*.so')):
        data = lib.read_bytes()
        start = data.find(MAGIC)
        while start != -1:
            try:
                resource = Gio.Resource.new_from_data(GLib.Bytes.new(data[start:]))
                resource.enumerate_children(RESOURCE_ROOT, 0)
                return resource
            except GLib.Error:
                start = data.find(MAGIC, start + 1)
    return None


def copy_shell_cursors(resource, out: Path, skip: set) -> int:
    copied = 0
    for name in resource.enumerate_children(RESOURCE_ROOT, 0):
        name = name.rstrip('/')
        # Mutsu draws its own (build-cursor-theme.py): never replace those.
        if name in skip or (out / name).exists() or (out / name).is_symlink():
            continue
        folder = out / name
        folder.mkdir(parents=True, exist_ok=True)
        for item in resource.enumerate_children(f'{RESOURCE_ROOT}{name}/', 0):
            data = resource.lookup_data(f'{RESOURCE_ROOT}{name}/{item}', 0).get_data()
            (folder / item).write_bytes(data)
        copied += 1
    return copied


def main(argv):
    if len(argv) not in (5, 6):
        sys.exit(__doc__)
    theme, arrow = Path(argv[1]), Path(argv[2])
    hot_x, hot_y = int(argv[3]), int(argv[4])
    nominal = int(argv[5]) if len(argv) == 6 else 32
    out = theme / 'cursors_scalable'
    folder = out / 'default'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'default.svg').write_bytes(arrow.read_bytes())
    (folder / 'metadata.json').write_text(json.dumps(
        [{'filename': 'default.svg', 'hotspot_x': hot_x, 'hotspot_y': hot_y,
          'nominal_size': nominal}], indent=4) + '\n')
    resource = shell_cursor_resource()
    if resource is None:
        print('warning: GNOME Shell\'s built-in SVG cursors not found; '
              'only the arrow is scalable', file=sys.stderr)
        return
    copied = copy_shell_cursors(resource, out, {'default'})
    print(f'Scalable cursors: Mutsu arrow + {copied} from GNOME Shell')


if __name__ == '__main__':
    main(sys.argv)
