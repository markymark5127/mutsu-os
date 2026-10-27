# Icons and Japandi lock screen

## Icons already present

- `mutsu-logo-symbol.svg` / symbolic white — panel, About, app icon
- `mutsu-logo-wordmark.svg` — GDM login, installer sidebar
- `mutsu-ai.svg`, `mutsu-app-grid.svg` — staged, not yet wired
- Japandi and Cyberpunk lockups and wordmarks

## Icons still needed for a polished look

| Asset | Use | Notes |
|-------|-----|-------|
| Lock-screen wordmark PNG | Centered on the lock screen | Transparent, sage `#788773`, ~480 px wide |
| User-avatar fallback | Lock screen when no photo is set | Soft Japandi circle with the two-wave mark |
| App-grid icon | Show Applications in the dock | `mutsu-app-grid.svg` exists; needs to be the dock button |
| Installer product logo PNG | Anaconda title area | Already have sidebar-logo; a wider lockup helps |
| Plymouth PNG | Boot splash | Generated at build from the white symbol SVG |
| Optional icon pack | Files, Settings, Terminal, Browser | Only if you want to replace Adwaita icons |

You do **not** need a full icon theme to look finished. The missing high-impact pieces are the lock-screen wordmark and the dock app-grid icon.

## Full Japandi lock screen

What first boot now sets:

- Screensaver wallpaper = Japandi 4K
- Primary color `#f3efe7`, secondary `#516b5c`
- GDM login logo = Mutsu wordmark (image build)

What is still required for a complete lock screen:

1. **GDM background** — GDM does not use the user screensaver wallpaper. Set it in `/etc/dconf/db/gdm.d/`:
   ```
   [org/gnome/desktop/background]
   picture-uri='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
   picture-options='zoom'
   ```
2. **Centered wordmark** on the lock screen. GNOME does not have a simple logo key for the lock screen; this needs a small extension or a custom GDM CSS.
3. **Clock and user-list styling** in Japandi sage, via GDM CSS (`/etc/gdm/custom.css` or a greeter theme).
4. **Fallback avatar** if the user has no photo.

## Dash to Dock

Yes, it can be preinstalled. UUID is `dash-to-dock@micxgx.gmail.com`.

First boot enables it and sets bottom / always visible / Show Applications **if the extension is already on the system**. Shipping the extension itself is a separate step (clone a GNOME-version-matched release into `/usr/share/gnome-shell/extensions/` during the image build). The image ships Dash to Dock; first boot only needs to enable and configure it.
