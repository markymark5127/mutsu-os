#!/usr/bin/env bash
# Replace Bazzite Portal content with Mutsu. Do not autostart it.
set -euo pipefail

src=/tmp/mutsu-portal-assets
[[ -s "$src/yafti.yml" ]] || {
  echo >&2 "Missing Mutsu Portal config"
  exit 1
}

install -d -m 0755 /usr/share/yafti
install -Dm0644 "$src/yafti.yml" /usr/share/yafti/yafti.yml
if [[ -d /usr/share/ublue-os/firstboot ]]; then
  install -Dm0644 "$src/yafti.yml" /usr/share/ublue-os/firstboot/yafti.yml
fi

install -d -m 0755 /usr/share/themes/MutsuJapandi/gtk-4.0
install -Dm0644 "$src/mutsu-portal.css" \
  /usr/share/themes/MutsuJapandi/gtk-4.0/gtk.css
printf 'MutsuJapandi\n' > /usr/share/themes/MutsuJapandi/index.theme

install -Dm0755 /tmp/mutsu-portal /usr/bin/mutsu-portal
install -Dm0644 /tmp/mutsu-portal.desktop \
  /usr/share/applications/mutsu-portal.desktop
if [[ -s /tmp/mutsu-updater.desktop ]]; then
  install -Dm0644 /tmp/mutsu-updater.desktop \
    /usr/share/applications/mutsu-updater.desktop
fi
if [[ -s /tmp/mutsu-documentation.desktop ]]; then
  install -Dm0644 /tmp/mutsu-documentation.desktop \
    /usr/share/applications/mutsu-documentation.desktop
fi

printf 'Mutsu Portal installed. It does not open on login.\n'

# Re-skin the portal window title if the GTK launcher hardcodes "Bazzite Portal".
for candidate in /usr/bin/yafti_gtk.py /usr/libexec/yafti_gtk.py; do
  if [[ -f "$candidate" ]] && grep -q "Bazzite Portal" "$candidate"; then
    sed -i 's/Bazzite Portal/Mutsu Portal/g' "$candidate" || true
  fi
done

