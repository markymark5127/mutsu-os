#!/usr/bin/env bash
# Runs as root inside the Mutsu image while the live USB is built (Tacklebox
# live_customize). Everything here exists only on the live USB.
#
# Tacklebox's own baseline runs first: live user, automatic login, no sleep,
# and the apps declared in /usr/share/flatpak/preinstall.d (Firefox and the
# rest of the default set), which the installer later copies to the disk.
#
# This script adds the installer: "Try Mutsu OS" is just using the live
# desktop; "Install Mutsu OS" (a desktop icon, the dock, and a window that
# opens at login) walks through installing to the laptop's disk.
#
# Two variants (variant.env, written by the workflow next to this script):
#   offline  the system image is on the USB (Tacklebox offline_payloads)
#            with the default apps: installs without internet.
#   online   small USB: the installer downloads the system from GHCR
#            straight to the target disk (fisherman keeps it out of the
#            live RAM), and the default apps install after the first boot.
set -euo pipefail

MUTSU_LIVE_VARIANT=offline
[[ -r ./variant.env ]] && source ./variant.env
echo "Mutsu live USB variant: $MUTSU_LIVE_VARIANT"

IMAGE_REF=${MUTSU_IMAGE_REF:-ghcr.io/markymark5127/mutsu-os:beta}  # installs follow the weekly Beta
INSTALLER_ID=org.bootcinstaller.Installer
INSTALLER_URL=${MUTSU_INSTALLER_URL:-https://github.com/tuna-os/bootc-installer/releases/latest/download/org.bootcinstaller.Installer.flatpak}
LIVE_HOME=/var/home/liveuser

# Fail the build rather than ship a live USB without a browser. The online
# variant skips the baked app set, so it installs Firefox on its own.
if [[ "$MUTSU_LIVE_VARIANT" == online ]] && ! flatpak info --system org.mozilla.firefox >/dev/null 2>&1; then
    flatpak install --system -y --noninteractive flathub org.mozilla.firefox
fi
flatpak info --system org.mozilla.firefox >/dev/null

# The live session never runs the local AI model or installs Newelle (their
# services skip live boots), so drop them from the live system: about 7 GB
# less on the USB. The installer's copy of the system image (the offline
# store) still has them, so installed systems are complete.
rm -rf /usr/share/mutsu-os/local-ai/models /usr/share/mutsu-os/newelle/flatpak.tar.zst

# The image carries an OSTree repository (/sysroot/ostree, ~8 GB): a second
# copy of /usr used when the image is deployed with OSTree. The live system
# runs straight from its squashfs and the installer installs from the
# system image (registry or the USB's offline store), never from this repo,
# so it is dead weight on the USB.
if [ -d /sysroot/ostree ]; then
  find /sysroot/ostree -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

# GNOME Tour and the Mutsu welcome (account-level setup for an installed
# system) would pop up over the installer in every live session.
rm -f /etc/xdg/autostart/org.gnome.Tour.desktop /etc/xdg/autostart/mutsu-welcome.desktop

# ── The installer app (GTK 4 bootc-installer + its fisherman backend) ─────
curl -fL --retry 3 -o /tmp/mutsu-installer.flatpak "$INSTALLER_URL"
flatpak install --system -y --noninteractive --bundle /tmp/mutsu-installer.flatpak
rm -f /tmp/mutsu-installer.flatpak
flatpak info --system "$INSTALLER_ID" >/dev/null

if [[ "$MUTSU_LIVE_VARIANT" == offline ]]; then
# ── The embedded system image: offline store on the USB ───────────────────
# Tacklebox writes the image store to LiveOS/store.squashfs.img on the
# media; mount it where fisherman/podman look for offline images.
install -d /var/lib/superiso-store
unit='var-lib-superiso\x2dstore.mount'
cat > "/etc/systemd/system/$unit" <<'UNIT'
[Unit]
Description=Mutsu OS installer: the system image on the USB
DefaultDependencies=no
After=local-fs-pre.target
Before=local-fs.target
ConditionPathExists=/run/initramfs/live/LiveOS/store.squashfs.img

[Mount]
What=/run/initramfs/live/LiveOS/store.squashfs.img
Where=/var/lib/superiso-store
Type=squashfs
Options=loop,ro,nodev

[Install]
WantedBy=local-fs.target
UNIT
install -d /etc/systemd/system/local-fs.target.wants
ln -sf "../$unit" "/etc/systemd/system/local-fs.target.wants/$unit"

# The live root is itself an overlay, so containers-storage needs
# fuse-overlayfs to stack on it; the USB store is read-only and extra.
command -v fuse-overlayfs >/dev/null || dnf5 install -y fuse-overlayfs
# In the main storage.conf, not a drop-in: every tool the installer uses
# (skopeo, podman, bootc) must see the USB store, and older tools ignore
# storage.conf.d. Without it fisherman's skopeo check missed the image and
# fell back to downloading it.
cat > /etc/containers/storage.conf <<'CONF'
# Mutsu live USB: the system image on the USB is an extra, read-only store.
[storage]
driver = "overlay"
runroot = "/run/containers/storage"
graphroot = "/var/lib/containers/storage"

[storage.options]
additionalimagestores = ["/var/lib/superiso-store"]

[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
CONF
rm -f /etc/containers/storage.conf.d/90-mutsu-live-installer.conf
fi

# ── Installer configuration (read from the host /etc) ─────────────────────
install -d /etc/bootc-installer
# No live-iso-mode flag: fisherman treats it as "this media has a verified
# OCI layout + media-input.json" (Tacklebox's pure-build format), which this
# USB does not use, and refuses to install ("live media requires
# /etc/bootc-installer/media-input.json"). Fisherman still knows it is live
# from the Tacklebox kernel argument, and finds the offline image in
# /var/lib/superiso-store on its own.
# Offline: name the copy on the USB explicitly (containers-storage:), so
# fisherman installs straight from it with the host's bootc (its path for
# 8 GB live installs) and never tries the registry. The installed system
# still updates from the plain registry name (fisherman strips the prefix).
INSTALL_REF=$IMAGE_REF
[[ "$MUTSU_LIVE_VARIANT" == offline ]] && INSTALL_REF="containers-storage:$IMAGE_REF"
cat > /etc/bootc-installer/images.json <<JSON
{
  "default_image": "$INSTALL_REF",
  "fallback_flatpaks": [],
  "images": [
    {
      "name": "Mutsu OS",
      "imgref": "$INSTALL_REF",
      "desc": "Mac-style desktop, gaming-ready, with tablet mode for 2-in-1s",
      "icon": "/usr/share/icons/hicolor/scalable/apps/mutsu-os-logo.svg",
      "bootloader": "grub2",
      "filesystem": "btrfs",
      "composefs": false,
      "needs_user_creation": true
    }
  ]
}
JSON
cat > /etc/bootc-installer/recipe.json <<JSON
{
  "log_file": "/var/log/bootc-installer.log",
  "distro_name": "Mutsu OS",
  "distro_logo": "/usr/share/icons/hicolor/scalable/apps/mutsu-os-logo.svg",
  "imgref": "$INSTALL_REF",
  "targetImgref": "$IMAGE_REF",
  "welcome_title": "Welcome to Mutsu OS",
  "welcome_subtitle": "Install Mutsu OS on this computer, or close this window to keep trying it from the USB.",
  "hostname": "mutsu",
  "filesystem": "btrfs",
  "btrfsSubvolumes": true,
  "unifiedStorage": true,
  "steps": {
    "welcome":    { "template": "welcome", "protected": true },
    "disk":       { "template": "disk" },
    "encryption": { "template": "encryption" },
    "user":       { "template": "user" }
  }
}
JSON

# The live user may run the installer backend without a password (the live
# session is passwordless anyway). The installer runs fisherman via pkexec
# from a temporary copy, which polkit sees as the generic exec action.
install -d /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/90-mutsu-live-installer.rules <<'RULES'
polkit.addRule(function (action, subject) {
    if ((action.id === "org.bootcos.Installer.install" ||
         action.id === "org.freedesktop.policykit.exec") &&
        subject.user === "liveuser" && subject.local && subject.active) {
        return polkit.Result.YES;
    }
});
RULES

# ── "Install Mutsu OS": app grid, desktop icon, and a window at login ─────
launcher=/usr/share/applications/mutsu-install.desktop
cat > "$launcher" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Install Mutsu OS
GenericName=Installer
Comment=Install Mutsu OS on this computer
Exec=flatpak run --env=BOOTC_CUSTOM_RECIPE=/run/host/etc/bootc-installer/recipe.json $INSTALLER_ID
Icon=mutsu-os-logo
Terminal=false
Categories=System;
StartupNotify=true
DESKTOP
install -Dm0644 "$launcher" /etc/xdg/autostart/mutsu-install.desktop
printf 'X-GNOME-Autostart-enabled=true\nX-GNOME-Autostart-Delay=3\n' >> /etc/xdg/autostart/mutsu-install.desktop

install -d -m0755 "$LIVE_HOME/Desktop"
install -m0755 "$launcher" "$LIVE_HOME/Desktop/mutsu-install.desktop"
# Desktop icons only launch .desktop files marked trusted, which needs the
# running session's metadata service: mark it at login.
cat > /usr/libexec/mutsu-live-trust-installer <<'SH'
#!/usr/bin/bash
gio set "$HOME/Desktop/mutsu-install.desktop" metadata::trusted true 2>/dev/null || true
SH
chmod 0755 /usr/libexec/mutsu-live-trust-installer
cat > /etc/xdg/autostart/mutsu-live-trust-installer.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Mutsu live: trust the installer icon
Exec=/usr/libexec/mutsu-live-trust-installer
NoDisplay=true
X-GNOME-Autostart-Phase=Applications
DESKTOP
chown -R 1000:1000 "$LIVE_HOME"

# First item in the live dock: the image's own dock list (Mutsu's dconf
# defaults first, then the base image's) with the installer in front.
install -d /etc/dconf/db/mutsu.d
python3 - <<'PY' > /etc/dconf/db/mutsu.d/96-mutsu-live-installer
import ast, glob, re
apps = []
for path in sorted(glob.glob("/etc/dconf/db/mutsu.d/*")) + sorted(glob.glob("/etc/dconf/db/*.d/*")):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        continue
    match = re.search(r"^\[org/gnome/shell\][^\[]*?^favorite-apps=([^\n]+)$", text, re.M | re.S)
    if match:
        try:
            apps = list(ast.literal_eval(match.group(1).strip().replace("@as ", "")))
            break
        except Exception:
            pass
apps = ["mutsu-install.desktop"] + [a for a in apps if a != "mutsu-install.desktop"]
print("[org/gnome/shell]")
print("favorite-apps=" + repr(apps))
PY
dconf update

# What takes the space on the USB (shown in the build log).
echo "== Largest folders in the live system =="
du -h --max-depth=2 --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/run --exclude=/tmp / 2>/dev/null | sort -h | tail -25 || true
du -xh --max-depth=4 /usr /var /opt 2>/dev/null | sort -h | tail -30 || true
