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
# opens at login) walks through installing to the laptop's disk. The system
# image itself is on the USB (Tacklebox offline_payloads), so installing
# needs no network and nothing is downloaded into the live session's RAM.
set -euo pipefail

IMAGE_REF=${MUTSU_IMAGE_REF:-ghcr.io/markymark5127/mutsu-os:latest}
INSTALLER_ID=org.bootcinstaller.Installer
INSTALLER_URL=${MUTSU_INSTALLER_URL:-https://github.com/tuna-os/bootc-installer/releases/latest/download/org.bootcinstaller.Installer.flatpak}
LIVE_HOME=/var/home/liveuser

# Fail the build rather than ship a live USB without a browser.
flatpak info --system org.mozilla.firefox >/dev/null

# The live session never runs the local AI model or installs Newelle (their
# services skip live boots), so drop them from the live system: about 7 GB
# less on the USB. The installer's copy of the system image (the offline
# store) still has them, so installed systems are complete.
rm -rf /usr/share/mutsu-os/local-ai/models /usr/share/mutsu-os/newelle/flatpak.tar.zst

# GNOME Tour would pop up over the desktop in every live session.
rm -f /etc/xdg/autostart/org.gnome.Tour.desktop

# ── The installer app (GTK 4 bootc-installer + its fisherman backend) ─────
curl -fL --retry 3 -o /tmp/mutsu-installer.flatpak "$INSTALLER_URL"
flatpak install --system -y --noninteractive --bundle /tmp/mutsu-installer.flatpak
rm -f /tmp/mutsu-installer.flatpak
flatpak info --system "$INSTALLER_ID" >/dev/null

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
install -d /etc/containers/storage.conf.d
cat > /etc/containers/storage.conf.d/90-mutsu-live-installer.conf <<'CONF'
[storage]
driver = "overlay"

[storage.options]
additionalimagestores = ["/var/lib/superiso-store"]

[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
CONF

# ── Installer configuration (read from the host /etc) ─────────────────────
install -d /etc/bootc-installer
: > /etc/bootc-installer/live-iso-mode
cat > /etc/bootc-installer/images.json <<JSON
{
  "default_image": "$IMAGE_REF",
  "fallback_flatpaks": [],
  "images": [
    {
      "name": "Mutsu OS",
      "imgref": "$IMAGE_REF",
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
  "imgref": "$IMAGE_REF",
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
