#!/usr/bin/env bash
# Make Newelle an OS preinstall on a persistent *installed* Mutsu system.
# Flatpak downloads made in a bootc image build live under /var and do not
# automatically become deployed Flatpaks on the user's installed system.
# Do not bake an API key, model download, or user-specific Flatpak permissions.
set -euo pipefail

command -v flatpak >/dev/null || {
  echo >&2 'Flatpak is missing: cannot support Newelle system preinstall'
  exit 1
}
# Stable Flatpak preinstall format; users may uninstall and opt out afterward.
install -d -m0755 /usr/share/flatpak/preinstall.d
cat > /usr/share/flatpak/preinstall.d/90-mutsu-newelle.preinstall <<'EOF'
[Flatpak Preinstall io.github.qwersyk.Newelle]
Branch=stable
Install=true
EOF

# Ensure Flathub exists on first boot without downloading apps into the
# build container's throwaway /var/lib/flatpak.
install -d -m0755 /etc/flatpak/remotes.d
if [[ ! -f /etc/flatpak/remotes.d/flathub.flatpakrepo ]]; then
  # Bazzite itself ordinarily provides this file; fall back if missing.
  curl --fail --location --retry 3 --silent --show-error \
    --output /etc/flatpak/remotes.d/flathub.flatpakrepo \
    https://dl.flathub.org/repo/flathub.flatpakrepo
fi
cat > /usr/lib/systemd/system/mutsu-newelle-preinstall.service <<'EOF'
[Unit]
Description=Install Mutsu OS default Newelle Flatpak when online
Wants=network-online.target
After=network-online.target
ConditionPathExists=/usr/share/flatpak/preinstall.d/90-mutsu-newelle.preinstall

[Service]
Type=oneshot
ExecStart=/usr/bin/flatpak preinstall --assumeyes
TimeoutStartSec=12min

[Install]
WantedBy=multi-user.target
EOF
systemctl enable mutsu-newelle-preinstall.service
echo 'Newelle OS preinstall manifest and network-aware first-boot service installed.'
