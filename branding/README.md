# Mutsu OS branding — source of truth for the *OS image*

The approved two-wave Mutsu mark is reused unchanged from
[ai-desktop/assets/icons](https://github.com/markymark5127/ai-desktop/tree/main/assets/icons).
The OS-owned copies live here so `mutsu-os` can package them without fetching
loose design files. No logo was redesigned or replaced.

## Status

| Surface | Assets | Installed/active |
| --- | --- | --- |
| GNOME About, Search icon, GDM | `icons/mutsu-logo-symbol.svg`, `icons/mutsu-logo-wordmark.svg`, `install-branding.sh` | Existing OS build integration; needs GUI verification |
| Desktop wallpapers | `wallpapers/mutsu-{japandi,cyberpunk}-4k.png` | Existing OS build integration; needs GUI verification |
| Theme palettes | `themes/*.json`, `shell/*.css` | Assets staged for future GNOME-version-tested loader; not active yet |
| App glyphs | `icons/mutsu-ai.svg`, `icons/mutsu-app-grid.svg` | Asset source only; app integration pending |
| Boot splash | `plymouth/mutsu.plymouth`, `mutsu.script`, `mutsu-boot-logo.svg` | Source files; NOT installed/activated on the OS image |
| Installer | `installer/*.png`, `installer/mutsu.css` | Existing best-effort integration; unverified in a fresh ISO |

The PNG boot emblem is **generated from the actual approved white Mutsu
symbol**. The source SVG is deliberately committed instead of an unreviewed
raster. On a workstation with `rsvg-convert`:

```sh
bash packaging/render-plymouth-theme.sh /tmp/mutsu-plymouth
file /tmp/mutsu-plymouth/mutsu-boot-logo.png
python3 packaging/check-branding-assets.py
```

On Fedora, `rsvg-convert` comes from `librsvg2-tools`.

**Caution:** Rendering does not install or enable the Plymouth theme. Before
making it default in a bootc image, the image build must install the script
plugin, generate a matching initramfs, and verify boot, disk-encryption password
prompts, failure fallback, and rollback in a disposable VM. Do not run
`plymouth-set-default-theme -R` on a daily-driver Bazzite system as a shortcut.

## Theme loading

The Shell CSS is **not** ordinary GTK4 CSS. It must be loaded by a verified
GNOME Shell extension (and unloaded/restored on disable), rather than dropped
into a user's `gtk.css`. The JSON palettes document the approved colors and
asset mapping; Mutsu Search's GTK app styles are currently maintained in
`ai-desktop/src/aidesktop/themes.py`. Connecting both to a common controller
is a separate implementation task.

The following remain optional artwork work:
- 16:10 wallpaper exports for convertible laptops;
- lock screen variants after verifying GDM behavior;
- public release screenshots and web banners.

Never replace upstream Fedora/Bazzite package IDs or icons en masse.
