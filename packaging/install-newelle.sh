#!/usr/bin/env bash
# Package offline first-boot deployment. Never run Flatpak/bwrap in OCI RUN.
set -euo pipefail

test -s /usr/share/mutsu-os/newelle/flatpak.tar.zst
test -s /usr/share/mutsu-os/newelle-gui-api/runtime.json

install -d -m0755 /usr/lib/systemd/user
cat > /usr/lib/systemd/user/ai-desktop-newelle.service <<'EOF'
[Unit]
Description=Headless Newelle backend for Mutsu OS
After=graphical-session-pre.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/flatpak run --env=PYTHONUNBUFFERED=1 io.github.qwersyk.Newelle --interface gui-api
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF
chmod 0644 /usr/lib/systemd/user/ai-desktop-newelle.service

install -d -m0755 /usr/libexec/mutsu-os /usr/lib/systemd/system
cat > /usr/libexec/mutsu-os/install-newelle-once <<'EOF'
#!/usr/bin/env bash
# Deploy the host-prepared Flatpak from immutable local files, without
# network access. An existing marker respects a user's later uninstall.
set -euo pipefail
marker=/var/lib/mutsu-os/newelle-preinstall-complete
app=io.github.qwersyk.Newelle

[[ ! -e "$marker" ]] || exit 0
command -v flatpak >/dev/null || exit 1

if flatpak info --system "$app" >/dev/null 2>&1; then
  if [[ "${MUTSU_IMAGE_BUILD:-0}" == 1 ]]; then exit 0; fi
  if command -v restorecon >/dev/null; then restorecon -RF /var/lib/flatpak; fi
  install -d -m0755 /var/lib/mutsu-os
  printf 'Existing Newelle installation retained.\n' > "$marker"
  chmod 0644 "$marker"
  exit 0
fi

staging="$(mktemp -d /var/tmp/mutsu-newelle-install.XXXXXXXX)"
trap 'rm -rf -- "$staging"' EXIT
tar --zstd -xf /usr/share/mutsu-os/newelle/flatpak.tar.zst -C "$staging"
seed="$staging/flatpak"
test -d "$seed/repo/objects"
test -d "$seed/app/$app"
# Configure the public remote directly with OSTree, so first boot does not
# refresh an online Flatpak summary. Its signing key is in the local payload.
python3 - "$staging" <<'FLATHUB_REMOTE'
import base64
import configparser
from pathlib import Path
import sys
root = Path(sys.argv[1])
config = configparser.ConfigParser(interpolation=None)
config.read(root / "flathub.flatpakrepo", encoding="utf-8")
remote = config["Flatpak Repo"]
(root / "flathub.gpg").write_bytes(base64.b64decode(remote["GPGKey"], validate=True))
(root / "flathub.url").write_text(remote["Url"], encoding="utf-8")
FLATHUB_REMOTE
install -d -m0755 /var/lib/flatpak/repo
if [[ ! -f /var/lib/flatpak/repo/config ]]; then
  ostree --repo=/var/lib/flatpak/repo init --mode=bare-user-only
fi
ostree --repo=/var/lib/flatpak/repo remote add --if-not-exists \
  --set=xa.title=Flathub --gpg-import="$staging/flathub.gpg" \
  flathub "$(cat "$staging/flathub.url")"
# Import objects/refs into the existing system repository, retaining its
# configuration, other remotes and apps. Deployment checkouts are already
# complete: do not run flatpak install or regenerate ldconfig in OCI.
# BEGIN OFFLINE REF IMPORT
# pull-local's implicit enumeration passes remote-qualified refspecs as plain
# branches, which rejects the colon in flathub:runtime/.... Pull immutable
# commits instead, then restore their full refspecs using the refs command.
ostree --repo="$seed/repo" refs --list > "$staging/refs.txt"
test -s "$staging/refs.txt"
while IFS= read -r refspec; do
  commit="$(ostree --repo="$seed/repo" rev-parse "$refspec")"
  [[ "$commit" =~ ^[0-9a-f]{64}$ ]] || { echo >&2 "Invalid commit for $refspec"; exit 1; }
  ostree --repo=/var/lib/flatpak/repo pull-local "$seed/repo" "$commit"
  ostree --repo=/var/lib/flatpak/repo refs --force --create="$refspec" "$commit"
done < "$staging/refs.txt"
# END OFFLINE REF IMPORT
for directory in app runtime exports; do
  if [[ -d "$seed/$directory" ]]; then
    install -d -m0755 "/var/lib/flatpak/$directory"
    cp -a "$seed/$directory/." "/var/lib/flatpak/$directory/"
    chown -R 0:0 "/var/lib/flatpak/$directory"
  fi
done
if [[ "${MUTSU_IMAGE_BUILD:-0}" != 1 ]] && command -v restorecon >/dev/null; then
  restorecon -RF /var/lib/flatpak
fi
touch /var/lib/flatpak/.changed
flatpak info --system "$app" >/dev/null

if [[ "${MUTSU_IMAGE_BUILD:-0}" == 1 ]]; then exit 0; fi
install -d -m0755 /var/lib/mutsu-os
printf 'Newelle installed from the offline OS payload; user may uninstall it.\n' > "$marker"
chmod 0644 "$marker"
EOF
chmod 0755 /usr/libexec/mutsu-os/install-newelle-once

cat > /usr/lib/systemd/system/mutsu-newelle-preinstall.service <<'EOF'
[Unit]
Description=Install bundled Newelle offline before the first login
After=local-fs.target
Before=systemd-user-sessions.service
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
# Safe in OCI: the worker imports already-prepared files; no Flatpak sandbox
# is launched. Leave the completion marker for the actual installed boot.
MUTSU_IMAGE_BUILD=1 /usr/libexec/mutsu-os/install-newelle-once
echo 'Newelle installed in the image; the local archive remains an offline recovery source.'
