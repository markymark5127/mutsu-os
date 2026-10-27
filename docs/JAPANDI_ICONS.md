# Mutsu Japandi icon specification

Build the Calm Japandi icon set first. Cyberpunk should reuse the same semantic
icon names and vector geometry with its own color tokens.

## Current visual language
- Primary sage #788773, cream #F3EFE7, off-white #FFFCF6, dark ink #232823.
- Round, restrained forms and consistent optical weight (not variable stroke widths).
- Application icons: design a **square 256×256 viewBox** full-color SVG.
- Symbolic actions/status: design a **16×16 or 24×24 viewBox** SVG using currentColor,
  with no embedded background; test at 16px, 24px and high-contrast.
- Keep SVGs simple: paths/circles/rects; avoid embedded bitmap data, fonts,
  browser-specific filters, and external image dependencies.
- Export optional 256×256 PNG for applications requiring raster assets.

## System priority
Already supplied as source: mutsu-logo-japandi.svg, mutsu-app-grid.svg,
mutsu-ai.svg, Mutsu wordmarks and boot emblem.

Create next:
1. Mutsu Settings / Preferences application icon.
2. Mutsu Portal / Welcome application icon.
3. Folder set: folder, folder-documents, folder-download, folder-pictures,
   folder-music, folder-videos.
4. Home, back/forward, search and refresh symbolic variants only where a
   Mutsu-owned UI needs them. GNOME Adwaita stays the fallback elsewhere.
5. Do not impersonate third-party app marks, Steam, browser or Flatpak icons.

## Source layout
```
branding/icons/                         # Approved source SVG masters
branding/icon-theme/MutsuJapandi/index.theme
/usr/share/icons/MutsuJapandi/scalable/apps/*.svg
/usr/share/icons/MutsuJapandi/scalable/actions/*.svg
```

`index.theme` declares the normal FreeDesktop icon directories and inherits
`Adwaita,hicolor`; missing icons continue to use the installed GNOME theme.
Mutsu's image build copies approved icons into the theme. A dconf default sets
`org.gnome.desktop.interface icon-theme='MutsuJapandi'` for new accounts, and
existing users are free to select another icon theme. Avoid replacing system
application IDs without a reviewed original icon.

## How to draw and submit
Use Inkscape, Penpot, Figma or Illustrator, preferably with an SVG master.
Design at 256×256; use the same sage/cream/ink token values. Keep all text
converted to paths or, preferably, omit text. Save SVG with a stable name,
test render at 16, 24, 48, 64, 128 and 256 pixels, and open a PR adding the
source SVG and its final icon-theme path. Validate SVG XML and check contrast.

## Limitations
This initial pack brands only Mutsu-owned icons. It does NOT reskin GNOME Files,
Settings, Steam or third-party apps. Mutsu's custom app-grid SVG is staged as
an action icon; the GNOME Shell/Dash-to-Dock Show Apps button may need a tested
extension-specific override to display it, depending on GNOME 50.
