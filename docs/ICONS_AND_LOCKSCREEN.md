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

GDM login (image build, `packaging/install-branding.sh`):

- `/etc/dconf/profile/gdm` reads `system-db:gdm` (created if the base image has none)
- `/etc/dconf/db/gdm.d/90-mutsu-logo` sets the wordmark, Japandi background, and sage colors
- `/usr/share/gnome-shell/theme/mutsu/gnome-shell.css` is the greeter wash

The session lock screen uses the same wallpaper and sage colors. GNOME blurs that
wallpaper on purpose; the clock and unlock controls stay sharp. A centered lock-screen
logo is not a GNOME setting and is not forced over the unlock UI.

## Dash to Dock

Yes, it can be preinstalled. UUID is `dash-to-dock@micxgx.gmail.com`.

First boot enables it and sets bottom / always visible / Show Applications **if the extension is already on the system**. Shipping the extension itself is a separate step (clone a GNOME-version-matched release into `/usr/share/gnome-shell/extensions/` during the image build). The image ships Dash to Dock; first boot only needs to enable and configure it.
