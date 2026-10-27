#!/usr/bin/env bash
# Replace Bazzite's first-boot look with Mutsu Japandi.
# Run only inside the Mutsu image build.
set -euo pipefail

wall=/usr/share/backgrounds/mutsu/mutsu-japandi-4k.png
[[ -s "$wall" ]] || {
  echo >&2 "Japandi wallpaper missing; branding must run first"
  exit 1
}

# Bazzite's local.d file sets the ublue wallpaper as the system default.
# A later file in the same directory wins.
install -d -m 0755 /etc/dconf/db/local.d
install -Dm0644 /tmp/mutsu-japandi.dconf /etc/dconf/db/local.d/90-mutsu-japandi

# Point the paths Bazzite uses for the greeter at Japandi.
for target in \
  /usr/share/backgrounds/default.png \
  /usr/share/backgrounds/default.jxl \
  /usr/share/backgrounds/default-dark.jxl \
  /usr/share/backgrounds/ublue.png
do
  if [[ -e "$target" || -L "$target" ]]; then
    ln -sfn "$wall" "$target"
  fi
done

# GDM does not read the user wallpaper. Give it the Mutsu logo and Japandi look.
install -d -m 0755 /etc/dconf/db/gdm.d
cat > /etc/dconf/db/gdm.d/90-mutsu-login <<'EOF'
[org/gnome/login-screen]
logo='/usr/share/pixmaps/mutsu/mutsu-login-wordmark.png'

[org/gnome/desktop/background]
picture-uri='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
picture-uri-dark='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
picture-options='zoom'
primary-color='#f3efe7'
secondary-color='#788773'

[org/gnome/desktop/screensaver]
picture-uri='file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png'
picture-options='zoom'
primary-color='#f3efe7'
secondary-color='#516b5c'
EOF

if command -v dconf >/dev/null; then
  dconf update
fi

printf 'Mutsu Japandi is the system default over Bazzite.\n'
