#!/usr/bin/env bash
# Stage Toshy. The installer refuses root, so first login installs it per user.
set -euo pipefail
src=/tmp/mutsu-toshy-src
dest=/usr/share/mutsu-os/toshy
rm -rf "$dest"
mkdir -p "$dest"
cp -a "$src/." "$dest/"
rm -rf "$dest/.git"
install -d -m0755 /usr/libexec/mutsu-os
install -Dm0755 /dev/stdin /usr/libexec/mutsu-os/setup-toshy-user.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
marker="${XDG_CONFIG_HOME:-$HOME/.config}/ai-desktop/toshy-seeded"
[[ ! -e "$marker" ]] || exit 0
if [[ -x "$HOME/.config/toshy/scripts/bin/toshy-services-enable" ]]; then
  mkdir -p "$(dirname "$marker")"
  touch "$marker"
  exit 0
fi
src=/usr/share/mutsu-os/toshy
[[ -f "$src/setup_toshy.py" ]] || exit 0
python3 "$src/setup_toshy.py" install --barebones-config
mkdir -p "$(dirname "$marker")"
touch "$marker"
EOF
install -Dm0644 /dev/stdin /usr/lib/systemd/user/mutsu-toshy-seed.service <<'EOF'
[Unit]
Description=Seed Toshy Mac shortcuts for this Mutsu user
After=graphical-session.target
ConditionPathExists=!%h/.config/ai-desktop/toshy-seeded

[Service]
Type=oneshot
ExecStart=/usr/libexec/mutsu-os/setup-toshy-user.sh
TimeoutStartSec=10min

[Install]
WantedBy=graphical-session.target
EOF
mkdir -p /etc/systemd/user/graphical-session.target.wants
ln -sfn /usr/lib/systemd/user/mutsu-toshy-seed.service \
  /etc/systemd/user/graphical-session.target.wants/mutsu-toshy-seed.service
echo "Toshy staged. First login installs it for the user."
