#!/usr/bin/env bash
# Stage a user-removable Newelle Flatpak for the FIRST boot of installed Mutsu OS.
# A bootc image build's /var/lib/flatpak is not persistent installed-system data.
# Use the stable Flatpak install CLI (Fedora 43/44 compatible); do not require
# newer 'flatpak preinstall' functionality or bake any model/API credentials.
set -euo pipefail

command -v flatpak >/dev/null || {
  echo >&2 'Flatpak missing from the Mutsu base image'
  exit 1
}

install -d -m0755 /usr/libexec/mutsu-os /usr/lib/systemd/system
cat > /usr/libexec/mutsu-os/install-newelle-once <<'EOF'
#!/usr/bin/env bash
# Runs as a root-owned systemd oneshot on an installed system, NOT in the image.
set -euo pipefail
marker=/var/lib/mutsu-os/newelle-preinstall-complete
app=io.github.qwersyk.Newelle

[[ ! -e "$marker" ]] || exit 0
command -v flatpak >/dev/null || exit 1

# Bazzite normally already has Flathub, but configure it on a clean install.
# If offline, fail and try again at the next boot. Never mark a failed install
# as complete, and do not override or remove existing user Flatpaks.
flatpak remote-add --system --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo

if ! flatpak info --system "$app" >/dev/null 2>&1; then
  flatpak install --system --noninteractive --assumeyes flathub "$app"
fi

# /var is persistent across bootc deployment updates. Once marked, subsequent
# boots won't reinstall the app if the user has intentionally uninstalled it.
install -d -m0755 /var/lib/mutsu-os
printf 'Newelle preinstalled once; user may uninstall it.\n' > "$marker"
chmod 0644 "$marker"
EOF
chmod 0755 /usr/libexec/mutsu-os/install-newelle-once

cat > /usr/lib/systemd/system/mutsu-newelle-preinstall.service <<'EOF'
[Unit]
Description=Install Mutsu OS optional Newelle Flatpak once after network comes up
Wants=network-online.target
After=network-online.target
ConditionPathExists=!/var/lib/mutsu-os/newelle-preinstall-complete

[Service]
Type=oneshot
ExecStart=/usr/libexec/mutsu-os/install-newelle-once
TimeoutStartSec=15min

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /usr/lib/systemd/system/mutsu-newelle-preinstall.service
systemctl enable mutsu-newelle-preinstall.service
echo 'Newelle first-boot installation service staged (offline retry, no forced reinstall).'
