#!/usr/bin/python3
"""Mutsu Japandi app and folder icons as liquid-glass objects (no tile).

    draw-glass-icons.py SVG_DIR             write the drawings (full + small)
    draw-glass-icons.py --render THEME_DIR  draw and render PNGs into an icon theme

Each symbol is the object itself, made of tinted Japandi glass: a lit rim, a
darker refracted edge, a soft shadow in its own colour and frosted cream for
paper and labels. At 32 px and below a simplified drawing is used (no blur,
bolder marks), because glass detail turns to mush that small. Rendered to PNG
at build time so GNOME shows exactly these pixels, filters included.
"""
import itertools
import math
import os
import subprocess
import sys
import tempfile

_n = itertools.count()
SMALL = False  # set while drawing the simplified small versions

# Japandi glass tints: (light, dark)
SAGE = ("#A9C2AA", "#5F7D66")
STONE = ("#B3C0C9", "#5E6E7A")
PERSIMMON = ("#EDA684", "#B85F3E")
SUMI = ("#6A625C", "#221F1D")
OCHRE = ("#EFCB8C", "#BC8A40")
INDIGO = ("#93A8C7", "#43567A")


def piece(d, tint, *, evenodd=False, alpha=(0.62, 0.86), shadow=True, rim=1.0):
    if SMALL:
        alpha = (min(1, alpha[0] + 0.3), min(1, alpha[1] + 0.12))
    """One glass piece: body, inner light, refracted edge, lit rim, specular."""
    p = f"go{next(_n)}"
    lt, dk = tint
    fr = ' fill-rule="evenodd" clip-rule="evenodd"' if evenodd else ""
    out = f"""
<defs>
  <linearGradient id="{p}b" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="{lt}" stop-opacity="{alpha[0]}"/><stop offset="1" stop-color="{dk}" stop-opacity="{alpha[1]}"/></linearGradient>
  <radialGradient id="{p}l" cx="0.28" cy="0.12" r="0.85"><stop offset="0" stop-color="#fff" stop-opacity="0.65"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="{p}r" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="{0.95*rim}"/><stop offset="0.5" stop-color="#fff" stop-opacity="{0.2*rim}"/><stop offset="1" stop-color="#fff" stop-opacity="{0.55*rim}"/></linearGradient>
  <clipPath id="{p}c"><path d="{d}"{fr}/></clipPath>
  <filter id="{p}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="{p}e" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>"""
    if SMALL:
        # small sizes: solid-ish glass, a lit rim and nothing blurred
        out += f'<path d="{d}"{fr} fill="url(#{p}b)"/>'
        out += f'<g clip-path="url(#{p}c)"><path d="{d}"{fr} fill="url(#{p}l)"/></g>'
        out += f'<path d="{d}"{fr} fill="none" stroke="{dk}" stroke-width="7" stroke-opacity="0.55"/>'
        out += f'<path d="{d}"{fr} fill="none" stroke="url(#{p}r)" stroke-width="4"/>'
        return out
    if shadow:
        out += f'<path d="{d}"{fr} fill="{dk}" opacity="0.38" transform="translate(0 14)" filter="url(#{p}bl)"/>'
    out += f'<path d="{d}"{fr} fill="url(#{p}b)"/>'
    out += f'<g clip-path="url(#{p}c)">'
    # refraction: the edge bends light, so it reads darker and richer
    out += f'<path d="{d}"{fr} fill="none" stroke="{dk}" stroke-width="14" opacity="0.45" filter="url(#{p}e)"/>'
    out += f'<path d="{d}"{fr} fill="url(#{p}l)"/>'
    # caustic: light gathered at the bottom inner edge
    out += f'<path d="{d}"{fr} fill="none" stroke="#fff" stroke-width="6" opacity="0.28" transform="translate(0 -4)" filter="url(#{p}e)"/>'
    out += '</g>'
    out += f'<path d="{d}"{fr} fill="none" stroke="url(#{p}r)" stroke-width="2.6"/>'
    return out


def specular(cx, cy, rx, ry, rot=-18, op=0.75):
    if SMALL:
        return ""
    p = f"go{next(_n)}"
    return (f'<defs><filter id="{p}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff" opacity="{op}" transform="rotate({rot} {cx} {cy})" filter="url(#{p})"/>')


def frost(d, op=0.9, evenodd=False):
    """Frosted cream insert (paper, labels) inside a glass object."""
    p = f"go{next(_n)}"
    fr = ' fill-rule="evenodd"' if evenodd else ""
    return (f'<defs><linearGradient id="{p}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#EFE5D3"/></linearGradient></defs>'
            f'<path d="{d}"{fr} fill="url(#{p})" opacity="{op}"/>')


def folder(tint, mark=""):
    back = "M44 78 q0-14 14-14 h46 q9 0 14 8 l8 12 h72 q14 0 14 14 v86 H44z"
    paper = "M62 80 q0-4 4-4 h124 q4 0 4 4 v40 H62z"
    front = "M34 112 q0-12 12-12 h164 q12 0 12 12 l-8 86 q-1.5 14-15.5 14 H57.5 q-14 0-15.5-14z"
    return (piece(back, (tint[0], tint[1]), alpha=(0.5, 0.75)) + frost(paper, 0.95) +
            piece(front, tint, alpha=(0.55, 0.82)) + specular(78, 122, 30, 6) + mark)


ICONS = {}

def files():
    return folder(SAGE)

def settings():
    import math
    # gear outline with a true hole
    pts = []
    teeth, ro, ri = 9, 96, 78
    for i in range(teeth * 4):
        a = math.tau * i / (teeth * 4) - math.pi / 2
        r = ro if i % 4 in (1, 2) else ri
        pts.append(f"{128 + r*math.cos(a):.1f} {128 + r*math.sin(a):.1f}")
    gear = "M" + " L".join(pts) + " Z M128 98 a30 30 0 1 0 0.01 0 Z"
    return piece(gear, STONE, evenodd=True) + specular(92, 74, 26, 6, -35)

def software():
    bag = "M62 92 h132 l-10 112 q-1.5 16-17.5 16 H89.5 q-16 0-17.5-16z"
    handle = "M98 96 v-14 q0-30 30-30 q30 0 30 30 v14 h-12 v-14 q0-18-18-18 q-18 0-18 18 v14z"
    return piece(handle, PERSIMMON, alpha=(0.6, 0.85)) + piece(bag, PERSIMMON) + specular(90, 112, 22, 6)

def terminal():
    slab = "M36 72 q0-18 18-18 h148 q18 0 18 18 v112 q0 18-18 18 H54 q-18 0-18-18z"
    p = f"go{next(_n)}"
    if SMALL:
        return piece(slab, SUMI, alpha=(0.72, 0.92)) + ('<path d="M74 102 l32 26 l-32 26" fill="none" stroke="#F3FAF2" stroke-width="18" '
            'stroke-linecap="round" stroke-linejoin="round"/><rect x="120" y="146" width="66" height="18" rx="9" fill="#CDE3CF"/>')
    glow = (f'<defs><filter id="{p}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>'
            f'<g filter="url(#{p})" opacity="0.8"><path d="M74 102 l32 26 l-32 26" fill="none" stroke="#B9D6BC" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></g>'
            f'<path d="M74 102 l32 26 l-32 26" fill="none" stroke="#F3FAF2" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<rect x="120" y="148" width="62" height="12" rx="6" fill="#CDE3CF"/>')
    return piece(slab, SUMI, alpha=(0.72, 0.92)) + glow + specular(84, 66, 34, 5, -8, 0.55)

def editor():
    page = "M66 46 h88 l42 42 v124 q0 12-12 12 H66 q-12 0-12-12 V58 q0-12 12-12z"
    fold = "M154 46 l42 42 h-30 q-12 0-12-12z"
    lines = "".join(f'<rect x="80" y="{y}" width="{w}" height="9" rx="4.5" fill="#FFF8EA" opacity="0.85"/>' for y, w in ((112, 92), (134, 92), (156, 60)))
    pencil = "M150 214 l58-58 l18 18 l-58 58 l-24 6z"
    return piece(page, OCHRE) + piece(fold, OCHRE, alpha=(0.75, 0.95), shadow=False) + lines + \
        piece(pencil, SAGE, alpha=(0.7, 0.9)) + specular(86, 66, 22, 5)

def _rot(points, ang=-45, cx=128, cy=128):
    import math
    a = math.radians(ang)
    out = []
    for x, y in points:
        out.append((cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)))
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in out) + " Z"


def _capsule(x0, x1, r, steps=14):
    import math
    pts = [(x1 - r + r * math.cos(t), r * math.sin(t)) for t in [(-math.pi / 2 + math.pi * i / steps) for i in range(steps + 1)]]
    pts += [(x0 + r + r * math.cos(t), r * math.sin(t)) for t in [(math.pi / 2 + math.pi * i / steps) for i in range(steps + 1)]]
    return pts


def mechanic():
    """Mutsu Mechanic: a sage glass screwdriver, handle low-left, tip high-right."""
    # local frame: x along the tool (handle at -98, tip at +100), centred on the icon
    handle = _rot(_capsule(-124, -10, 32))
    grip = "".join(f'<path d="{_rot(_capsule(-108, -28, 3.6, 6), -45)}" transform="translate({y*0.707:.1f} {y*0.707:.1f})" fill="#FFFFFF" opacity="0.22"/>' for y in (-13, 0, 13))
    ferrule = _rot([(-14, -22), (14, -22), (14, 22), (-14, 22)])
    shaft = _rot([(12, -11), (90, -11), (90, 11), (12, 11)])
    tip = _rot([(88, -13), (108, -9), (120, -3), (120, 3), (108, 9), (88, 13)])
    return (piece(handle, SAGE, alpha=(0.6, 0.88)) + grip +
            frost(ferrule, 0.95) +
            piece(shaft, STONE, alpha=(0.55, 0.8), shadow=True, rim=0.8) +
            piece(tip, STONE, alpha=(0.65, 0.9), shadow=False, rim=0.8) +
            specular(74, 166, 34, 6, -45, 0.75))




def home():
    return folder(SAGE, '<path d="M108 182 v-26 l20-17 l20 17 v26z" fill="#FFFDF8" opacity="0.85"/>')

def docs():
    return folder(OCHRE, '<rect x="104" y="150" width="48" height="9" rx="4.5" fill="#FFFDF8" opacity="0.85"/><rect x="104" y="168" width="32" height="9" rx="4.5" fill="#FFFDF8" opacity="0.85"/>')

def downloads():
    return folder(PERSIMMON, '<path d="M128 140 v36 m-16-15 l16 16 l16-16" fill="none" stroke="#FFFDF8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>')

def _mark(svg):
    return svg.replace("{w}", "16" if SMALL else "10")


def folder_generic():
    return folder(SAGE)


def desktop():
    return folder(STONE, _mark('<rect x="102" y="140" width="52" height="34" rx="5" fill="none" stroke="#FFFDF8" stroke-width="{w}" opacity="0.9"/>'))


def music():
    return folder(INDIGO, _mark('<path d="M138 136 v34 M138 136 l18 6" fill="none" stroke="#FFFDF8" stroke-width="{w}" stroke-linecap="round" opacity="0.9"/>'
                                '<circle cx="128" cy="172" r="11" fill="#FFFDF8" opacity="0.9"/>'))


def pictures():
    return folder(SAGE, '<path d="M98 180 l20-24 l12 13 l10-10 l20 21z" fill="#FFFDF8" opacity="0.9"/><circle cx="148" cy="146" r="8" fill="#FFFDF8" opacity="0.9"/>')


def videos():
    return folder(INDIGO, '<path d="M116 140 v40 l34-20z" fill="#FFFDF8" opacity="0.9"/>')


def templates():
    return folder(OCHRE, _mark('<rect x="106" y="138" width="44" height="40" rx="6" fill="none" stroke="#FFFDF8" stroke-width="{w}" stroke-dasharray="10 7" opacity="0.9"/>'))


def removable():
    return folder(STONE, '<rect x="114" y="136" width="28" height="44" rx="6" fill="#FFFDF8" opacity="0.9"/><rect x="120" y="128" width="16" height="10" rx="2" fill="#FFFDF8" opacity="0.7"/>')


def trash():
    knob = "M110 62 v-8 q0-6 6-6 h24 q6 0 6 6 v8z"
    lid = "M62 72 q0-10 10-10 h112 q10 0 10 10 v12 H62z"
    can = "M72 94 h112 l-10 116 q-1.5 14-15.5 14 H97.5 q-14 0-15.5-14z"
    w = "13" if SMALL else "8"
    ribs = "".join(f'<path d="M{x} 116 l{dx} 86" stroke="#FFFDF8" stroke-width="{w}" stroke-linecap="round" opacity="0.6"/>' for x, dx in ((104, 3), (128, 0), (152, -3)))
    return piece(knob, STONE, alpha=(0.6, 0.85), shadow=False) + piece(lid, STONE) + piece(can, STONE) + ribs + specular(96, 108, 18, 5)


def updater():
    disc = "M128 32 a96 96 0 1 0 0.01 0z"
    w = "20" if SMALL else "14"
    arrow = (f'<path d="M128 80 v76 M100 132 l28 28 l28-28" fill="none" stroke="#FFFDF8" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>'
             f'<path d="M98 186 h60" stroke="#FFFDF8" stroke-width="{w}" stroke-linecap="round" opacity="0.7"/>')
    return piece(disc, SAGE, alpha=(0.5, 0.85)) + arrow + specular(92, 70, 32, 9, -30, 0.8)


def documentation():
    book = "M58 50 q0-14 14-14 h112 q14 0 14 14 v156 q0 14-14 14 H72 q-14 0-14-14z"
    spine = "M58 50 q0-14 14-14 h18 v184 h-18 q-14 0-14-14z"
    w = "16" if SMALL else "11"
    lines = (f'<path d="M108 104 q34-24 68-4 M108 140 q34-24 68-4" fill="none" stroke="#FFFDF8" stroke-width="{w}" stroke-linecap="round" opacity="0.9"/>')
    return piece(book, OCHRE) + piece(spine, OCHRE, alpha=(0.8, 0.95), shadow=False) + lines + specular(124, 60, 30, 5)


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
        print(f"Mutsu glass icons: {len(NAMES)} drawings, {count} PNGs in {len(SIZES)} sizes")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--render":
        render(sys.argv[2])
    elif len(sys.argv) == 2:
        write_svgs(sys.argv[1])
    else:
        sys.exit(__doc__)
