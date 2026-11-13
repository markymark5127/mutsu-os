#!/usr/bin/env bash
# Only for Containerfile RUN during a Mutsu OS derived OCI image build.
# NEVER run this directly on an installed Fedora/Bazzite operating system.
set -euo pipefail

if [[ ! -d /tmp/mutsu-brand-assets/icons ]] || [[ ! -f /usr/lib/os-release ]]; then
  echo >&2 "This script must run inside the Mutsu image build context."
  exit 1
fi

# The shell prompt uses the hostname, independently of os-release branding.
# Replace inherited image defaults; keep a builder's explicit custom name.
image_hostname="$(cat /etc/hostname 2>/dev/null || true)"
case "$image_hostname" in
  ''|bazzite|bazzite.localdomain|localhost|localhost.localdomain)
    printf 'mutsu\n' > /etc/hostname
    ;;
esac

brand=/tmp/mutsu-brand-assets
symbol="$brand/icons/mutsu-logo-symbol.svg"
wordmark="$brand/icons/mutsu-logo-wordmark.svg"
if [[ ! -s "$symbol" || ! -s "$wordmark" ]]; then
  echo >&2 "Mutsu OS build needs mutsu-logo-symbol.svg and mutsu-logo-wordmark.svg in branding/icons/."
  exit 1
fi

# Install first-party icon theme with Adwaita/hicolor fallback.
# Do not rebrand GNOME's/third-party apps without dedicated artwork.
theme="$brand/icon-theme/MutsuJapandi/index.theme"
[[ -s "$theme" ]] || { echo >&2 "Missing MutsuJapandi index.theme"; exit 1; }
install -Dm0644 "$theme" /usr/share/icons/MutsuJapandi/index.theme
# Cyberpunk icon theme (neon folders/apps). Switched at runtime via icon-theme.
if [[ -s "$brand/icon-theme/MutsuCyberpunk/index.theme" ]]; then
  install -Dm0644 "$brand/icon-theme/MutsuCyberpunk/index.theme" /usr/share/icons/MutsuCyberpunk/index.theme
  if [[ -d "$brand/icon-theme/MutsuCyberpunk/scalable" ]]; then
    cp -a "$brand/icon-theme/MutsuCyberpunk/scalable/." /usr/share/icons/MutsuCyberpunk/scalable/
  fi
  # Ensure desktop folder and updater exist in the cyberpunk theme
  if [[ -s "$brand/icons/folder-desktop-cyberpunk.svg" ]]; then
    install -Dm0644 "$brand/icons/folder-desktop-cyberpunk.svg" \
      /usr/share/icons/MutsuCyberpunk/scalable/places/folder-desktop.svg
    install -Dm0644 "$brand/icons/folder-desktop-cyberpunk.svg" \
      /usr/share/icons/MutsuCyberpunk/scalable/places/user-desktop.svg
  fi
  if [[ -s /usr/share/icons/MutsuCyberpunk/scalable/places/folder-home.svg ]]; then
    install -Dm0644 /usr/share/icons/MutsuCyberpunk/scalable/places/folder-home.svg \
      /usr/share/icons/MutsuCyberpunk/scalable/places/user-home.svg
  fi
  if [[ -s "$brand/icons/mutsu-updater-cyberpunk.svg" ]]; then
    install -Dm0644 "$brand/icons/mutsu-updater-cyberpunk.svg" \
      /usr/share/icons/MutsuCyberpunk/scalable/apps/mutsu-updater.svg
  fi
  if [[ -s "$brand/icons/mutsu-docs-cyberpunk.svg" ]]; then
    install -Dm0644 "$brand/icons/mutsu-docs-cyberpunk.svg" \
      /usr/share/icons/MutsuCyberpunk/scalable/apps/mutsu-docs.svg
  fi
fi
install -Dm0644 "$brand/icons/mutsu-logo-japandi.svg" \
  /usr/share/icons/MutsuJapandi/scalable/apps/mutsu-os-logo.svg
install -Dm0644 "$brand/icons/mutsu-ai.svg" \
  /usr/share/icons/MutsuJapandi/scalable/apps/mutsu-ai.svg
install -Dm0644 "$brand/icons/mutsu-app-grid.svg" \
  /usr/share/icons/MutsuJapandi/scalable/actions/mutsu-app-grid.svg
# Dock "Show Apps" button: nine round dots and no tile (the Shoji Glass
# render) instead of GNOME's faint grey grid. Dash to Dock asks for view-app-grid-<mode>-symbolic and
# falls back to view-app-grid-symbolic; both themes get both names. Colours
# come from the Shell CSS (color on .show-apps-icon).
for theme_dir in MutsuJapandi MutsuCyberpunk; do
  for name in view-app-grid-symbolic view-app-grid-user-symbolic; do
    install -Dm0644 "$brand/icons/mutsu-show-apps-symbolic.svg" \
      "/usr/share/icons/$theme_dir/scalable/actions/$name.svg"
  done
done

# The new approved Japandi assets use standard theme lookup paths so
# Nautilus can show sage folders without replacing third-party app branding.
for icon in folder folder-desktop folder-documents folder-downloads folder-home \
         folder-music folder-pictures folder-removable folder-templates \
         folder-trash folder-videos; do
  if [[ -s "$brand/icons/$icon.svg" ]]; then
    install -Dm0644 "$brand/icons/$icon.svg" \
      "/usr/share/icons/MutsuJapandi/scalable/places/$icon.svg"
  fi
done
# The source asset is plural; the standard FreeDesktop lookup is singular.
install -Dm0644 "$brand/icons/folder-downloads.svg" \
  /usr/share/icons/MutsuJapandi/scalable/places/folder-download.svg
install -Dm0644 "$brand/icons/folder-downloads.svg" \
  /usr/share/icons/MutsuJapandi/scalable/places/folder-downloads.svg
# Nautilus looks up the Desktop special directory as user-desktop, not
# folder-desktop. Home is user-home. Ship both names.
install -Dm0644 "$brand/icons/folder-desktop.svg" \
  /usr/share/icons/MutsuJapandi/scalable/places/user-desktop.svg
if [[ -s "$brand/icons/folder-home.svg" ]]; then
  install -Dm0644 "$brand/icons/folder-home.svg" \
    /usr/share/icons/MutsuJapandi/scalable/places/user-home.svg
fi

for icon in mutsu-portal mutsu-settings mutsu-updater mutsu-docs; do
  if [[ -s "$brand/icons/$icon.svg" ]]; then
    install -Dm0644 "$brand/icons/$icon.svg" \
      "/usr/share/icons/MutsuJapandi/scalable/apps/$icon.svg"
  fi
done
for icon in mutsu-search-symbolic mutsu-tablet-mode-symbolic; do
  install -Dm0644 "$brand/icons/$icon.svg" \
    "/usr/share/icons/MutsuJapandi/scalable/actions/$icon.svg"
done

# Install without deleting Fedora/Bazzite icons or renaming RPMs/services.
install -Dm0644 "$symbol" /usr/share/icons/hicolor/scalable/apps/mutsu-os-logo.svg
# GNOME and some fallback dialogs request 'distributor-logo' rather than
# LOGO=mutsu-os-logo. Point that desktop-visible alias at Mutsu too.
install -Dm0644 "$symbol" /usr/share/icons/hicolor/scalable/places/distributor-logo.svg
install -Dm0644 "$symbol" /usr/share/icons/MutsuJapandi/scalable/places/distributor-logo.svg
install -Dm0644 "$symbol" /usr/share/icons/MutsuCyberpunk/scalable/places/distributor-logo.svg
install -Dm0644 "$symbol" /usr/share/icons/hicolor/scalable/apps/io.github.markymark5127.AIDesktop.svg
install -Dm0644 "$brand/icons/mutsu-ai.svg" /usr/share/icons/hicolor/scalable/apps/mutsu-ai.svg
install -Dm0644 "$symbol" /usr/share/pixmaps/mutsu/mutsu-logo-symbol.svg
install -Dm0644 "$wordmark" /usr/share/pixmaps/mutsu/mutsu-logo-wordmark.svg
if [[ -s "$brand/icons/mutsu-logo-symbolic.svg" ]]; then
  install -Dm0644 "$brand/icons/mutsu-logo-symbolic.svg" \
    /usr/share/icons/hicolor/symbolic/apps/mutsu-os-symbolic.svg
fi

# GDM draws the login logo at the file's natural size. The SVG is 1060px
# wide, so render a compact PNG instead.
command -v rsvg-convert >/dev/null || {
  echo >&2 "Missing librsvg2-tools in the Mutsu image"
  exit 1
}
# Cream ink: it sits at the foot of the login screen over the dark front
# ridges of the dawn background, where the sage wordmark disappeared.
login_logo=/usr/share/pixmaps/mutsu/mutsu-login-wordmark.png
grep -q 'fill="#788773"' "$wordmark" || {
  echo >&2 "Wordmark colour changed: update the cream login recolour"; exit 1; }
sed 's/fill="#788773"/fill="#FBF7EE"/' "$wordmark" | \
  rsvg-convert --width=280 --keep-aspect-ratio --output="$login_logo"
test -s "$login_logo"

# Login screen background (the baked Shell theme's #lockDialogGroup).
install -Dm0644 "$brand/wallpapers/mutsu-login-2560.png" \
  /usr/share/backgrounds/mutsu/mutsu-login.png

for name in mutsu-japandi-4k.png mutsu-japandi-mist-4k.png mutsu-cyberpunk-4k.png; do
  if [[ ! -s "$brand/wallpapers/$name" ]]; then
    echo >&2 "Missing Mutsu wallpaper: $name"
    exit 1
  fi
  install -Dm0644 "$brand/wallpapers/$name" "/usr/share/backgrounds/mutsu/$name"
done
# List them in Settings > Appearance so the earlier mist art stays pickable.
install -d -m 0755 /usr/share/gnome-background-properties
cat > /usr/share/gnome-background-properties/mutsu-os.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE wallpapers SYSTEM "gnome-wp-list.dtd">
<wallpapers>
  <wallpaper deleted="false">
    <name>Mutsu Liquid Shoji</name>
    <filename>/usr/share/backgrounds/mutsu/mutsu-japandi-4k.png</filename>
    <options>zoom</options>
  </wallpaper>
  <wallpaper deleted="false">
    <name>Mutsu Mist</name>
    <filename>/usr/share/backgrounds/mutsu/mutsu-japandi-mist-4k.png</filename>
    <options>zoom</options>
  </wallpaper>
  <wallpaper deleted="false">
    <name>Mutsu Cyberpunk</name>
    <filename>/usr/share/backgrounds/mutsu/mutsu-cyberpunk-4k.png</filename>
    <options>zoom</options>
  </wallpaper>
</wallpapers>
XML

# Stage additional approved Mutsu artwork and palette sources.
if [[ -s "$brand/icons/mutsu-login-cyberpunk.svg" ]]; then
  install -Dm0644 "$brand/icons/mutsu-login-cyberpunk.svg" \
    /usr/share/mutsu-os/branding/icons/mutsu-login-cyberpunk.svg
fi
for asset in "$brand"/icons/mutsu-logo-*.svg \
             "$brand"/icons/mutsu-wordmark-*.svg \
             "$brand"/icons/mutsu-lockup-*.svg \
             "$brand"/icons/mutsu-ai.svg \
             "$brand"/icons/mutsu-app-grid.svg; do
  [[ -s "$asset" ]] || continue
  install -Dm0644 "$asset" "/usr/share/mutsu-os/branding/icons/${asset##*/}"
done
for theme in japandi cyberpunk; do
  install -Dm0644 "$brand/themes/$theme.json" \
    "/usr/share/mutsu-os/branding/themes/$theme.json"
  install -Dm0644 "$brand/shell/$theme.css" \
    "/usr/share/mutsu-os/branding/shell/$theme.css"
done
# GTK CSS for rounded (Japandi) vs squared (Cyberpunk) plus Mac stoplights
if [[ -d "$brand/gtk" ]]; then
  install -d -m 0755 /usr/share/mutsu-os/branding/gtk
  for f in "$brand"/gtk/*.css; do
    [[ -s "$f" ]] || continue
    install -Dm0644 "$f" "/usr/share/mutsu-os/branding/gtk/${f##*/}"
  done
fi

# ---------------------------------------------------------------------------
# Plymouth boot splash
# ---------------------------------------------------------------------------
# Install the Mutsu script theme and set it as the default so the next
# initramfs (generated by bootc/dracut) includes it.
plymouth_src="$brand/plymouth"
plymouth_dest=/usr/share/plymouth/themes/mutsu
if [[ -d "$plymouth_src" ]]; then
  install -d -m 0755 "$plymouth_dest"
  install -Dm0644 "$plymouth_src/mutsu.plymouth" "$plymouth_dest/mutsu.plymouth"
  install -Dm0644 "$plymouth_src/mutsu.script" "$plymouth_dest/mutsu.script"
  install -Dm0644 "$plymouth_src/mutsu-boot-logo.svg" "$plymouth_dest/mutsu-boot-logo.svg"

  # Fail the image build if the renderer or plugin is missing, rather than
  # quietly publish a generic upstream boot splash.
  [[ -f /usr/lib64/plymouth/script.so ]] || {
    echo >&2 "Missing plymouth-plugin-script in the Mutsu image"
    exit 1
  }
  logo_png="$plymouth_dest/mutsu-boot-logo.png"
  rsvg-convert --width=512 --height=512 \
    --output="$logo_png" "$plymouth_src/mutsu-boot-logo.svg"
  test -s "$logo_png"
  # Do not call -R here (CI host kernel != image kernel). The final
  # Containerfile stage chooses the default and rebuilds the image initramfs.
else
  echo >&2 "WARNING: branding/plymouth/ not present; boot splash stays upstream"
fi

# Anaconda live installer sidebar branding (Japandi sage).
installer="$brand/installer"
if [[ -d "$installer" ]]; then
  install -d -m 0755 /usr/share/anaconda/pixmaps
  for f in sidebar-bg.png sidebar-logo.png topbar-bg.png mutsu.css; do
    if [[ -s "$installer/$f" ]]; then
      install -Dm0644 "$installer/$f" "/usr/share/anaconda/pixmaps/$f"
    else
      echo >&2 "WARNING: missing installer branding file $f (ISO sidebar will use upstream)"
    fi
  done
  if [[ -s /usr/share/anaconda/pixmaps/mutsu.css ]]; then
    ln -sf mutsu.css /usr/share/anaconda/pixmaps/mutsu-product.css || true
  fi
  # Stage .buildstamp so Anaconda product name can be "Mutsu OS" without
  # relying on blanking VERSION_ID (which breaks bootc-image-builder).
  if [[ -s "$installer/.buildstamp" ]]; then
    install -Dm0644 "$installer/.buildstamp" /usr/share/anaconda/.buildstamp
  fi
else
  echo >&2 "WARNING: branding/installer/ not present; Anaconda will keep upstream sidebar."
fi

# Display name is "Mutsu OS". Fedora 44 must not leak into Anaconda, GDM,
# or the desktop. Keep the upstream release number only as a dnf var so
# Fedora repos still resolve $releasever.
python3 - <<'PY'
from pathlib import Path

path = Path("/usr/lib/os-release")
lines = path.read_text(encoding="utf-8").splitlines()
values = {}
for line in lines:
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key] = value.strip().strip('"')

release = values.get("VERSION_ID") or values.get("VERSION", "").split()[0]
if release:
    var = Path("/etc/dnf/vars/releasever")
    var.parent.mkdir(parents=True, exist_ok=True)
    var.write_text(release + "\n", encoding="utf-8")

# Anaconda titles itself as NAME + VERSION_ID. Keep VERSION_ID numeric
# (required by bootc-image-builder to parse the distro name). Blank only
# the human-readable VERSION string. The installer product name is
# controlled separately via product.img / .buildstamp.
patch = {
    "NAME": '"Mutsu OS"',
    # Shown in Settings > About and boot entries.
    "PRETTY_NAME": '"Mutsu OS 1.0 (Shibui)"',
    "VERSION": '"1.0 (Shibui)"',
    "VARIANT": '"Shibui"',
    "VARIANT_ID": '"shibui"',
    # systemd falls back to this hostname when /etc/hostname is missing
    # (the live USB, fresh installs), which the terminal prompt and
    # GSConnect / KDE Connect show. Bazzite sets it to "bazzite".
    "DEFAULT_HOSTNAME": '"mutsu"',
    "LOGO": "mutsu-os-logo",
    "HOME_URL": '"https://github.com/markymark5127/mutsu-os"',
    "SUPPORT_URL": '"https://github.com/markymark5127/mutsu-os/discussions"',
    "BUG_REPORT_URL": '"https://github.com/markymark5127/mutsu-os/issues"',
    "DOCUMENTATION_URL": '"https://github.com/markymark5127/mutsu-os/blob/main/branding/docs/RELEASE_NOTES.md"',
}
# Preserve the original VERSION_ID so the image builder can parse
# "{ID}-{VERSION_ID}" (e.g. bazzite-44). Do not blank it.
seen = set()
output = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in patch:
        if key not in seen:
            output.append(f"{key}={patch[key]}")
            seen.add(key)
    else:
        output.append(line)
for key, value in patch.items():
    if key not in seen:
        output.append(f"{key}={value}")
path.write_text("\n".join(output) + "\n", encoding="utf-8")

for release_file in (Path("/etc/system-release"), Path("/etc/fedora-release"), Path("/usr/lib/system-release")):
    if release_file.exists() and not release_file.is_symlink():
        release_file.write_text("Mutsu OS\n", encoding="utf-8")
PY

# GDM login screen. The user screensaver wallpaper does not apply here.
# Preserve a distribution profile and make sure it reads the gdm database.
profile=/etc/dconf/profile/gdm
if [[ ! -f "$profile" ]]; then
  printf '%s\n' 'user-db:user' 'system-db:gdm' 'file-db:/usr/share/gdm/greeter-dconf-defaults' > "$profile"
else
  grep -qx 'system-db:gdm' "$profile" || printf '%s\n' 'system-db:gdm' >> "$profile"
fi
chmod 0644 "$profile"

if command -v dconf >/dev/null 2>&1; then
  install -d -m 0755 /etc/dconf/db/gdm.d
  cat > /etc/dconf/db/gdm.d/90-mutsu-logo <<'DCONF'
[org/gnome/login-screen]
logo='/usr/share/pixmaps/mutsu/mutsu-login-wordmark.png'
banner-message-enable=false

[org/gnome/desktop/background]
picture-uri='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
picture-uri-dark='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
picture-options='zoom'
primary-color='#f3efe7'
secondary-color='#516b5c'

[org/gnome/desktop/screensaver]
picture-uri='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
primary-color='#f3efe7'
secondary-color='#516b5c'

# The login screen is its own account (gdm) with its own settings: without
# these it showed GNOME's cursor, icons, font and clock until you logged in.
[org/gnome/desktop/interface]
color-scheme='prefer-light'
accent-color='green'
cursor-theme='MutsuJapandi'
icon-theme='MutsuJapandi'
clock-format='12h'

[org/gnome/desktop/sound]
theme-name='MutsuJapandi'
DCONF
  dconf update
else
  echo >&2 "WARNING: dconf unavailable; Mutsu GDM branding must be configured separately."
fi

# Greeter CSS. Keeps the Mutsu mark and clock readable over the Japandi wash.
# GNOME still blurs the session lock wallpaper; the colors stay in-palette.
install -d -m 0755 /usr/share/gnome-shell/theme/mutsu
cat > /usr/share/gnome-shell/theme/mutsu/gnome-shell.css <<'CSS'
#lockDialogGroup {
  background-color: #3B5547;
  background-image: url("file:///usr/share/backgrounds/mutsu/mutsu-login.png");
  background-size: cover;
  background-position: center;
}
.login-dialog-logo-bin {
  padding-bottom: 24px;
}
CSS

# Rebuild so Nautilus sees user-desktop without waiting for a manual cache.


# Core app icons, so Files, Settings, Terminal, Software and Text Editor
# match the sage folders instead of stock GNOME.
for theme in japandi cyberpunk; do
  src="$brand/icons/apps/$theme"
  dest="/usr/share/icons/Mutsu${theme^}/scalable/apps"
  [[ -d "$src" ]] || continue
  install -d -m0755 "$dest"
  cp -a "$src/." "$dest/"
  # Bazzite's GNOME terminal is Ptyxis (org.gnome.Ptyxis), not GNOME Terminal.
  if [[ -f "$dest/org.gnome.Terminal.svg" ]]; then
    install -m0644 "$dest/org.gnome.Terminal.svg" "$dest/org.gnome.Ptyxis.svg"
  fi
  # Bazzite's app store is Bazaar (it replaced GNOME Software in 2025).
  if [[ -f "$dest/org.gnome.Software.svg" ]]; then
    install -m0644 "$dest/org.gnome.Software.svg" "$dest/io.github.kolunmi.Bazaar.svg"
  fi
done

# Japandi app and folder icons as flat objects (no tile, no glass: the Shell
# is the glass), rendered to PNG at every size (simplified drawings at 32 px
# and below). They replace the older drawings above; other apps keep theirs.
python3 "$brand/icons/objects/draw-icons.py" --render /usr/share/icons/MutsuJapandi

# Sound theme. Quiet tones; inherits freedesktop for anything we do not ship.
if [[ -d "$brand/sounds/MutsuJapandi" ]]; then
  install -d -m0755 /usr/share/sounds/MutsuJapandi
  cp -a "$brand/sounds/MutsuJapandi/." /usr/share/sounds/MutsuJapandi/
fi

# Cursor sources and font preference. Adwaita remains the fallback cursor.
# GNOME only reads Xcursor files, so the SVG is converted at build time
# (hotspot = arrow tip at 3,5 on the 32 px drawing). Cursors not drawn yet
# fall back to Adwaita through the theme's Inherits line.
if [[ -s "$brand/cursors/japandi/left_ptr.svg" ]]; then
  cursors=/usr/share/icons/MutsuJapandi/cursors
  install -d -m0755 "$cursors"
  # Mutsu's drawn set (arrow, hand, text, resize, busy...), Xcursor and
  # scalable, with every alias name; see branding/cursors/draw-japandi-cursors.py.
  python3 "$brand/cursors/build-cursor-theme.py" \
    "$brand/cursors/japandi" /usr/share/icons/MutsuJapandi
  # GNOME Shell 51 draws the pointer itself from SVG cursors
  # (cursors_scalable); the Xcursor files above are only for Xwayland apps.
  # Without these the login screen and Shell used GNOME's own arrow.
  python3 "$brand/cursors/build-scalable-cursors.py" \
    /usr/share/icons/MutsuJapandi "$brand/cursors/japandi/left_ptr.svg" 3 5 32
  [[ -s /usr/share/icons/MutsuJapandi/cursors_scalable/default/metadata.json ]] || {
    echo >&2 "ERROR: Mutsu's scalable arrow was not installed"; exit 1; }
  # Any cursor Mutsu doesn't draw comes straight from Adwaita. The theme's Inherits line should cover this, but
  # GNOME Shell logged "can't load 'wait' / 'pointer' / 'ew-resize'..." on
  # real hardware, so link each name explicitly instead of relying on it.
  adwaita=/usr/share/icons/Adwaita/cursors
  if [[ -d "$adwaita" ]]; then
    # Each link points straight at the real file: several Adwaita names
    # (n-resize, s-resize, w-resize, zoom-in, progress) are themselves links,
    # and GNOME Shell still logged those as missing through a link to a link.
    link_cursor() {  # link_cursor <name> <Adwaita file or link>
      local real
      real="$(readlink -f "$2")"
      [[ -f "$real" ]] || return 1
      ln -sfn "$(realpath --relative-to="$cursors" "$real")" "$cursors/$1"
    }
    for source in "$adwaita"/*; do
      name=$(basename "$source")
      [[ -e "$cursors/$name" || -L "$cursors/$name" ]] && continue
      link_cursor "$name" "$source" || true
    done
    # CSS cursor names GNOME asks for, with the older X11 names some Adwaita
    # builds use instead. Link each missing one to the first that exists.
    while read -r name alternatives; do
      [[ -z "$name" || -e "$cursors/$name" ]] && continue
      for alt in $alternatives; do
        if [[ -e "$adwaita/$alt" ]] && link_cursor "$name" "$adwaita/$alt"; then
          break
        fi
      done
    done <<'NAMES'
text xterm ibeam
vertical-text xterm text
wait watch left_ptr_watch progress
progress left_ptr_watch watch wait
pointer hand2 hand1 pointing_hand
grab openhand hand1
grabbing closedhand fleur
move fleur grabbing
help question_arrow left_ptr_help
crosshair cross tcross
not-allowed crossed_circle forbidden circle
no-drop crossed_circle not-allowed
copy dnd-copy
alias dnd-link link
context-menu left_ptr
cell plus crosshair
all-scroll fleur
ew-resize sb_h_double_arrow h_double_arrow col-resize
ns-resize sb_v_double_arrow v_double_arrow row-resize
col-resize sb_h_double_arrow h_double_arrow ew-resize
row-resize sb_v_double_arrow v_double_arrow ns-resize
nesw-resize fd_double_arrow size_bdiag
nwse-resize bd_double_arrow size_fdiag
n-resize top_side ns-resize
s-resize bottom_side ns-resize
e-resize right_side ew-resize
w-resize left_side ew-resize
ne-resize top_right_corner nesw-resize
nw-resize top_left_corner nwse-resize
se-resize bottom_right_corner nwse-resize
sw-resize bottom_left_corner nesw-resize
zoom-in zoom-in
zoom-out zoom-out
NAMES
    missing=()
    for need in text wait pointer se-resize ew-resize ns-resize row-resize col-resize progress grab grabbing not-allowed \
        n-resize s-resize e-resize w-resize zoom-in zoom-out; do
      [[ -f "$cursors/$need" ]] || missing+=("$need")
    done
    printf 'Cursor theme: %s names (Mutsu-drawn set + Adwaita links)\n' "$(ls "$cursors" | wc -l)"
    [[ ${#missing[@]} -eq 0 ]] || echo >&2 "warning: cursors still missing: ${missing[*]}"
    ls "$adwaita" | tr '\n' ' ' | head -c 2000; echo
  else
    echo >&2 "warning: Adwaita cursors not found; relying on Inherits=Adwaita"
  fi
fi
if [[ -s "$brand/fonts/60-mutsu-fonts.conf" ]]; then
  install -Dm0644 "$brand/fonts/60-mutsu-fonts.conf" /etc/fonts/conf.d/60-mutsu-fonts.conf
fi
# GNOME's own interface (menus, windows, top bar) uses the font-name
# setting, not the fontconfig preference above. Point it at Inter only when
# the font is really installed, so a missing package cannot break text.
# Fedora's rsms-inter-fonts 4.x installs the variable font, whose family is
# "Inter Variable"; older/static builds use "Inter".
inter_family=''
if command -v fc-list >/dev/null 2>&1; then
  families=$(fc-list : family | tr ',' '\n')
  for candidate in 'Inter' 'Inter Variable'; do
    if grep -qx "$candidate" <<<"$families"; then inter_family=$candidate; break; fi
  done
fi
if [[ -n "$inter_family" ]]; then
  install -d -m0755 /etc/dconf/db/mutsu.d
  printf "[org/gnome/desktop/interface]\nfont-name='%s 11'\ndocument-font-name='%s 11'\n" \
    "$inter_family" "$inter_family" > /etc/dconf/db/mutsu.d/41-mutsu-fonts
  # The login screen too (its own gdm settings).
  if [[ -d /etc/dconf/db/gdm.d ]]; then
    printf "[org/gnome/desktop/interface]\nfont-name='%s 11'\n" "$inter_family" \
      > /etc/dconf/db/gdm.d/41-mutsu-fonts
  fi
  command -v dconf >/dev/null 2>&1 && dconf update
  echo "GNOME interface font: $inter_family"
else
  echo >&2 'Inter is not installed; GNOME keeps its default interface font.'
  fc-list : family | grep -i inter >&2 || true
fi

# Default avatars and the boot-menu picture.
if [[ -d "$brand/avatars" ]]; then
  install -d -m0755 /usr/share/pixmaps/faces
  cp -a "$brand/avatars/." /usr/share/pixmaps/faces/
fi
if [[ -s "$brand/grub/mutsu-grub.svg" ]]; then
  install -Dm0644 "$brand/grub/mutsu-grub.svg" /usr/share/backgrounds/mutsu/mutsu-grub.svg
fi

# Build the icon caches last, after every icon above is in place. OSTree
# images set all file times to the same value, so GTK cannot tell that a
# cache built earlier is stale and would silently miss newer icons.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f /usr/share/icons/MutsuJapandi || true
  gtk-update-icon-cache -f /usr/share/icons/MutsuCyberpunk || true
fi

# Brand guide and release notes stay on the installed system.
install -d -m0755 /usr/share/doc/mutsu-os
install -Dm0644 "$brand/docs/BRAND_GUIDE.md" /usr/share/doc/mutsu-os/BRAND_GUIDE.md
install -Dm0644 "$brand/docs/RELEASE_NOTES.md" /usr/share/doc/mutsu-os/RELEASE_NOTES.md

printf 'Mutsu OS image branding installed: GNOME logo, OS display name, login logo, wallpapers, Anaconda sidebar, and Plymouth theme.\n'

# Local beginner guide so Documentation works offline.
if [[ -s "$brand/docs/BEGINNER.md" ]]; then
  install -Dm0644 "$brand/docs/BEGINNER.md" /usr/share/mutsu-os/docs/BEGINNER.md
fi

