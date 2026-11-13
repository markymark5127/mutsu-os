#!/usr/bin/python3
"""Mutsu Japandi app and folder icons: flat, modern objects (no tile).

    draw-icons.py SVG_DIR             write the drawings (full + small)
    draw-icons.py --render THEME_DIR  draw and render PNGs into an icon theme

Each icon is the object itself (a folder, a gear, a paper bag), not a
rounded-square app tile, drawn flat in the Japandi palette: two or three solid
tones per object, a lit top lip, a quiet diagonal shade, cream paper and
labels, and one small flat shadow. No gradients, no gloss, no blur, so they
sit calmly next to the liquid-glass Shell instead of competing with it. At
32 px and below a simplified drawing is used (no shadow or lip, bolder
marks). Rendered to PNG at build time so GNOME shows exactly these pixels.
"""
import itertools
import math
import os
import subprocess
import sys
import tempfile

_n = itertools.count()
SMALL = False  # set while drawing the simplified small versions

# Japandi tones: (light, dark); the body is the mix between them.
SAGE = ("#A3BBA4", "#5F7D66")
STONE = ("#B6C0C6", "#64737D")
PERSIMMON = ("#EBA483", "#B65E3E")
SUMI = ("#5B5550", "#2A2725")
OCHRE = ("#EDCB8E", "#B9873F")
INDIGO = ("#97A9C3", "#4A5D7E")
CREAM = "#FBF6EC"
PAPER = "#F1E8D8"
INK = "#2B2F2C"


def mix(a, b, t):
    a = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(a, b))


def body(tint):
    return mix(tint[0], tint[1], 0.42)


def piece(d, tint, *, evenodd=False, tone=None, shadow=True, lip=True):
    """One flat piece: a solid body, a lit top lip, a quiet diagonal shade."""
    p = f"fo{next(_n)}"
    lt, dk = tint
    fill = tone or body(tint)
    fr = ' fill-rule="evenodd" clip-rule="evenodd"' if evenodd else ""
    out = f'<defs><clipPath id="{p}c"><path d="{d}"{fr}/></clipPath></defs>'
    if shadow and not SMALL:
        out += f'<path d="{d}"{fr} fill="{dk}" opacity="0.22" transform="translate(0 7)"/>'
    out += f'<path d="{d}"{fr} fill="{fill}"/>'
    out += f'<g clip-path="url(#{p}c)">'
    # flat shade: the lower right half of the object sits a step darker
    out += f'<path d="M256 -40 L256 296 L-40 296 Z" fill="{dk}" opacity="0.13"/>'
    if lip and not SMALL:
        # the top edge catches the light: an inner band along the upper rim
        out += f'<path d="{d}"{fr} fill="none" stroke="#FFFFFF" stroke-width="8" opacity="0.30" transform="translate(0 4)"/>'
    out += '</g>'
    return out


def flat(d, colour, op=1.0, evenodd=False):
    """A plain flat insert: paper, labels, marks."""
    fr = ' fill-rule="evenodd"' if evenodd else ""
    return f'<path d="{d}"{fr} fill="{colour}" opacity="{op}"/>'


def w(full, small):
    return small if SMALL else full


def folder(tint, mark=""):
    back = "M44 74 q0-14 14-14 h46 q9 0 14 8 l8 12 h72 q14 0 14 14 v90 H44z"
    paper = "M60 82 q0-4 4-4 h128 q4 0 4 4 v40 H60z"
    paper2 = "M68 90 q0-4 4-4 h112 q4 0 4 4 v32 H68z"
    front = "M32 114 q0-14 14-14 h164 q14 0 14 14 l-6 82 q-1.2 16-17.2 16 H55.2 q-16 0-17.2-16z"
    seam = f'<path d="M44 124 H212" stroke="#FFFFFF" stroke-width="{w(3, 0)}" opacity="0.28" stroke-linecap="round"/>' if not SMALL else ""
    return (piece(back, tint, tone=tint[1], lip=False) + flat(paper2, PAPER) + flat(paper, CREAM) +
            piece(front, tint, shadow=False) + seam + mark)


def files():
    return folder(SAGE)


def settings():
    pts = []
    teeth, ro, ri = 9, 98, 80
    for i in range(teeth * 4):
        a = math.tau * i / (teeth * 4) - math.pi / 2
        r = ro if i % 4 in (1, 2) else ri
        pts.append(f"{128 + r*math.cos(a):.1f} {128 + r*math.sin(a):.1f}")
    gear = "M" + " L".join(pts) + " Z M128 100 a28 28 0 1 0 0.01 0 Z"
    ring = "M128 66 a62 62 0 1 0 0.01 0 Z M128 96 a32 32 0 1 0 0.01 0 Z"
    return (piece(gear, STONE, evenodd=True) +
            flat(ring, STONE[1], 0.28, evenodd=True) +
            f'<circle cx="128" cy="128" r="{w(14, 18)}" fill="{OCHRE[0]}"/>')


def software():
    bag = "M60 90 h136 l-10 116 q-1.5 16-17.5 16 H87.5 q-16 0-17.5-16z"
    handle = "M96 96 v-16 q0-32 32-32 q32 0 32 32 v16 h-13 v-16 q0-19-19-19 q-19 0-19 19 v16z"
    fold = "M60 90 h136 l-1.6 18 H61.6z"
    tag = (f'<circle cx="128" cy="154" r="{w(26, 32)}" fill="{CREAM}"/>'
           f'<path d="M112 148 q16-14 32 0 M112 164 q16-14 32 0" fill="none" stroke="{PERSIMMON[1]}" '
           f'stroke-width="{w(6, 9)}" stroke-linecap="round"/>')
    return (piece(handle, PERSIMMON, tone=PERSIMMON[1], shadow=False, lip=False) + piece(bag, PERSIMMON) +
            flat(fold, PERSIMMON[1], 0.35) + tag)


def terminal():
    slab = "M32 64 q0-18 18-18 h156 q18 0 18 18 v128 q0 18-18 18 H50 q-18 0-18-18z"
    bar = "M32 64 q0-18 18-18 h156 q18 0 18 18 v12 H32z"
    dots = "" if SMALL else "".join(
        f'<circle cx="{x}" cy="62" r="7" fill="{c}"/>' for x, c in ((58, PERSIMMON[0]), (80, OCHRE[0]), (102, SAGE[0])))
    prompt = (f'<path d="M70 114 l30 26 l-30 26" fill="none" stroke="{SAGE[0]}" stroke-width="{w(13, 20)}" '
              f'stroke-linecap="round" stroke-linejoin="round"/>'
              f'<rect x="116" y="{w(156, 152)}" width="{w(66, 70)}" height="{w(13, 20)}" rx="{w(6.5, 10)}" fill="{CREAM}"/>')
    return piece(slab, SUMI, tone=SUMI[0]) + flat(bar, "#FFFFFF", 0.10) + dots + prompt


def editor():
    page = "M62 40 h92 l44 44 v128 q0 14-14 14 H62 q-14 0-14-14 V54 q0-14 14-14z"
    fold = "M154 40 l44 44 h-30 q-14 0-14-14z"
    lines = "".join(f'<rect x="76" y="{y}" width="{ln}" height="{w(9, 14)}" rx="{w(4.5, 7)}" fill="{OCHRE[1]}" opacity="0.75"/>'
                    for y, ln in ((104, 84), (128, 84), (152, 52)))
    pencil = "M148 214 l60-60 l20 20 l-60 60 l-26 6z"
    tip = "M148 214 l20 20 l-26 6z"
    band = "M196 166 l20 20 l8 -8 l-20 -20z"
    return (piece(page, OCHRE, tone=CREAM) + flat(fold, OCHRE[0]) + lines +
            piece(pencil, SAGE, shadow=False) + flat(band, OCHRE[1]) + flat(tip, PAPER) +
            flat("M142 240 l8-2 l-6-6z", INK))


def _rot(points, ang=-45, cx=128, cy=128):
    a = math.radians(ang)
    out = [(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in points]
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in out) + " Z"


def _capsule(x0, x1, r, steps=14):
    pts = [(x1 - r + r * math.cos(t), r * math.sin(t)) for t in [(-math.pi / 2 + math.pi * i / steps) for i in range(steps + 1)]]
    pts += [(x0 + r + r * math.cos(t), r * math.sin(t)) for t in [(math.pi / 2 + math.pi * i / steps) for i in range(steps + 1)]]
    return pts


def mechanic():
    """Mutsu Mechanic: a sage screwdriver, handle low-left, tip high-right."""
    handle = _rot(_capsule(-124, -10, 32))
    grip = "".join(f'<path d="{_rot(_capsule(-106, -30, w(4, 5), 6), -45)}" transform="translate({y*0.707:.1f} {y*0.707:.1f})" '
                   f'fill="{SAGE[1]}" opacity="0.55"/>' for y in (-14, 0, 14))
    ferrule = _rot([(-14, -22), (14, -22), (14, 22), (-14, 22)])
    shaft = _rot([(12, -10), (92, -10), (92, 10), (12, 10)])
    tip = _rot([(90, -12), (108, -8), (120, -3), (120, 3), (108, 8), (90, 12)])
    return (piece(handle, SAGE) + grip + flat(ferrule, OCHRE[0]) +
            piece(shaft, STONE, shadow=True, lip=False) + piece(tip, STONE, tone=STONE[1], shadow=False, lip=False))


def _mark(svg):
    return svg.replace("{w}", "16" if SMALL else "10")


def home():
    return folder(SAGE, f'<path d="M106 186 v-26 l22-19 l22 19 v26z" fill="{CREAM}"/><rect x="122" y="168" width="12" height="18" fill="{SAGE[1]}"/>')


def docs():
    return folder(OCHRE, f'<rect x="102" y="150" width="52" height="{w(9, 14)}" rx="4.5" fill="{CREAM}"/>'
                         f'<rect x="102" y="170" width="34" height="{w(9, 14)}" rx="4.5" fill="{CREAM}"/>')


def downloads():
    return folder(PERSIMMON, f'<path d="M128 140 v38 m-17-16 l17 17 l17-17" fill="none" stroke="{CREAM}" stroke-width="{w(11, 17)}" '
                             'stroke-linecap="round" stroke-linejoin="round"/>')


def folder_generic():
    return folder(SAGE)


def desktop():
    return folder(STONE, _mark(f'<rect x="100" y="140" width="56" height="36" rx="5" fill="none" stroke="{CREAM}" stroke-width="{{w}}"/>'
                               f'<path d="M116 186 h24" stroke="{CREAM}" stroke-width="{{w}}" stroke-linecap="round"/>'))


def music():
    return folder(INDIGO, _mark(f'<path d="M140 136 v36 M140 136 l18 6" fill="none" stroke="{CREAM}" stroke-width="{{w}}" stroke-linecap="round"/>'
                                f'<circle cx="129" cy="174" r="12" fill="{CREAM}"/>'))


def pictures():
    return folder(SAGE, f'<path d="M96 184 l22-26 l13 14 l11-11 l22 23z" fill="{CREAM}"/><circle cx="150" cy="148" r="9" fill="{OCHRE[0]}"/>')


def videos():
    return folder(INDIGO, f'<path d="M114 140 v44 l38-22z" fill="{CREAM}" stroke="{CREAM}" stroke-width="6" stroke-linejoin="round"/>')


def templates():
    return folder(OCHRE, _mark(f'<rect x="104" y="138" width="48" height="42" rx="6" fill="none" stroke="{CREAM}" stroke-width="{{w}}" stroke-dasharray="11 8"/>'))


def removable():
    return folder(STONE, f'<rect x="112" y="138" width="32" height="46" rx="7" fill="{CREAM}"/>'
                         f'<rect x="119" y="128" width="18" height="12" rx="2" fill="{CREAM}" opacity="0.8"/>')


def trash():
    knob = "M108 60 v-8 q0-7 7-7 h26 q7 0 7 7 v8z"
    lid = "M58 70 q0-10 10-10 h120 q10 0 10 10 v14 H58z"
    can = "M70 94 h116 l-10 116 q-1.5 14-15.5 14 H95.5 q-14 0-15.5-14z"
    ribs = "".join(f'<path d="M{x} 116 l{dx} 86" stroke="{CREAM}" stroke-width="{w(9, 14)}" stroke-linecap="round" opacity="0.85"/>'
                   for x, dx in ((104, 3), (128, 0), (152, -3)))
    return (piece(knob, STONE, tone=STONE[1], shadow=False, lip=False) + piece(can, STONE) +
            piece(lid, STONE, tone=STONE[1]) + ribs)


def updater():
    disc = "M128 30 a98 98 0 1 0 0.01 0z"
    inner = "M128 54 a74 74 0 1 0 0.01 0z"
    arrow = (f'<path d="M128 82 v74 M100 130 l28 28 l28-28" fill="none" stroke="{CREAM}" stroke-width="{w(15, 22)}" '
             'stroke-linecap="round" stroke-linejoin="round"/>'
             f'<path d="M98 184 h60" stroke="{OCHRE[0]}" stroke-width="{w(15, 22)}" stroke-linecap="round"/>')
    return piece(disc, SAGE) + ("" if SMALL else flat(inner, SAGE[1], 0.22)) + arrow


def documentation():
    book = "M56 48 q0-14 14-14 h116 q14 0 14 14 v160 q0 14-14 14 H70 q-14 0-14-14z"
    pages = "M196 50 h6 v156 h-6z"
    spine = "M56 48 q0-14 14-14 h20 v188 h-20 q-14 0-14-14z"
    arcs = (f'<path d="M108 104 q36-26 72-4 M108 140 q36-26 72-4" fill="none" stroke="{CREAM}" stroke-width="{w(12, 17)}" '
            'stroke-linecap="round"/>')
    ribbon = "" if SMALL else f'<path d="M160 34 v52 l10-8 l10 8 v-52z" fill="{PERSIMMON[1]}"/>'
    return (piece(book, OCHRE) + flat(pages, CREAM, 0.7) + piece(spine, OCHRE, tone=OCHRE[1], shadow=False, lip=False) +
            ribbon + arcs)


APPS = {"files": ("Files", files), "settings": ("Settings", settings), "software": ("Software", software),
        "terminal": ("Terminal", terminal), "editor": ("Text Editor", editor), "mechanic": ("Mutsu Mechanic", mechanic),
        "home": ("Home", home), "docs": ("Documents", docs), "downloads": ("Downloads", downloads),
        "folder": ("Folder", folder_generic), "desktop": ("Desktop", desktop), "music": ("Music", music),
        "pictures": ("Pictures", pictures), "videos": ("Videos", videos), "templates": ("Templates", templates),
        "removable": ("Removable", removable), "trash": ("Trash", trash),
        "updater": ("Software Updates", updater), "documentation": ("Documentation", documentation)}


# Theme names each drawing is installed under (context, names).
NAMES = {
    "files": ("apps", ["org.gnome.Nautilus", "system-file-manager"]),
    "settings": ("apps", ["org.gnome.Settings", "preferences-system", "mutsu-settings"]),
    "software": ("apps", ["org.gnome.Software", "io.github.kolunmi.Bazaar"]),
    "terminal": ("apps", ["org.gnome.Terminal", "org.gnome.Ptyxis", "utilities-terminal"]),
    "editor": ("apps", ["org.gnome.TextEditor", "accessories-text-editor"]),
    "mechanic": ("apps", ["mutsu-ai", "io.github.markymark5127.AIDesktop"]),
    "updater": ("apps", ["mutsu-updater"]),
    "documentation": ("apps", ["mutsu-docs"]),
    "folder": ("places", ["folder"]),
    "home": ("places", ["folder-home", "user-home"]),
    "desktop": ("places", ["folder-desktop", "user-desktop"]),
    "docs": ("places", ["folder-documents"]),
    "downloads": ("places", ["folder-downloads", "folder-download"]),
    "music": ("places", ["folder-music"]),
    "pictures": ("places", ["folder-pictures"]),
    "videos": ("places", ["folder-videos"]),
    "templates": ("places", ["folder-templates"]),
    "removable": ("places", ["folder-removable"]),
    "trash": ("places", ["user-trash", "folder-trash"]),
}
SIZES = (16, 22, 24, 32, 48, 64, 96, 128, 256, 512)
SMALL_MAX = 32


def drawing(app, small=False):
    global SMALL
    SMALL = small
    try:
        label, fn = APPS[app]
        # small drawings sit a little larger in their box: less air at 16 px
        view = "8 8 240 240" if small else "0 0 256 256"
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="{view}" '
                f'role="img" aria-label="{label}">{fn()}</svg>\n')
    finally:
        SMALL = False


def write_svgs(out):
    os.makedirs(out, exist_ok=True)
    for app in NAMES:
        for small in (False, True):
            with open(os.path.join(out, f"{app}{'-small' if small else ''}.svg"), "w") as f:
                f.write(drawing(app, small))


def render(theme):
    with tempfile.TemporaryDirectory() as tmp:
        write_svgs(tmp)
        count = 0
        for app, (context, names) in NAMES.items():
            for size in SIZES:
                svg = os.path.join(tmp, f"{app}{'-small' if size <= SMALL_MAX else ''}.svg")
                folder = os.path.join(theme, f"{size}x{size}", context)
                os.makedirs(folder, exist_ok=True)
                first = os.path.join(folder, names[0] + ".png")
                subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", first, svg], check=True)
                for alias in names[1:]:
                    link = os.path.join(folder, alias + ".png")
                    if os.path.lexists(link):
                        os.remove(link)
                    os.symlink(names[0] + ".png", link)
                count += 1
            # the PNGs replace any older scalable drawing of the same name
            for name in names:
                old = os.path.join(theme, "scalable", context, name + ".svg")
                if os.path.lexists(old):
                    os.remove(old)
        print(f"Mutsu Japandi icons: {len(NAMES)} drawings, {count} PNGs in {len(SIZES)} sizes")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--render":
        render(sys.argv[2])
    elif len(sys.argv) == 2:
        write_svgs(sys.argv[1])
    else:
        sys.exit(__doc__)
