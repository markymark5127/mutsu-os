#!/usr/bin/env bash
# Bake Newelle into the image, and keep a first-boot fallback.
# bootc seeds /var from the image on first install, so a system Flatpak
# installed here is present without a download. The oneshot only runs if
# that seed is missing. No model or API credential is baked in.
set -euo pipefail

command -v flatpak >/dev/null || {
  echo >&2 'Flatpak missing from the Mutsu base image'
  exit 1
}

app=io.github.qwersyk.Newelle
flatpak remote-add --system --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo
if ! flatpak info --system "$app" >/dev/null 2>&1; then
  flatpak install --system --noninteractive --assumeyes flathub "$app"
fi

install -d -m0755 /usr/lib/systemd/user
cat > /usr/lib/systemd/user/ai-desktop-newelle.service <<'EOF'
[Unit]
Description=Headless Newelle backend for Mutsu OS
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/flatpak run io.github.qwersyk.Newelle --interface gui-api
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
chmod 0644 /usr/lib/systemd/user/ai-desktop-newelle.service

install -d -m0755 /usr/libexec/mutsu-os /usr/lib/systemd/system
cat > /usr/libexec/mutsu-os/install-newelle-once <<'EOF'
#!/usr/bin/env bash
# Fallback only. The image already contains Newelle. This runs if the
# bootc /var seed did not include it.
set -euo pipefail
marker=/var/lib/mutsu-os/newelle-preinstall-complete
app=io.github.qwersyk.Newelle

[[ ! -e "$marker" ]] || exit 0
command -v flatpak >/dev/null || exit 1

if flatpak info --system "$app" >/dev/null 2>&1; then
  install -d -m0755 /var/lib/mutsu-os
  printf 'Newelle was baked into the image.\n' > "$marker"
  chmod 0644 "$marker"
  exit 0
fi

flatpak remote-add --system --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --system --noninteractive --assumeyes flathub "$app"

install -d -m0755 /var/lib/mutsu-os
printf 'Newelle installed by fallback; user may uninstall it.\n' > "$marker"
chmod 0644 "$marker"
EOF
chmod 0755 /usr/libexec/mutsu-os/install-newelle-once

cat > /usr/lib/systemd/system/mutsu-newelle-preinstall.service <<'EOF'
[Unit]
Description=Confirm baked Newelle, or install it once if the image seed is missing
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
echo 'Newelle baked into the image. First-boot unit is a fallback only.'
