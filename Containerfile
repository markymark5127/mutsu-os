# Allow build scripts to be referenced without being copied into the final image
FROM scratch AS ctx
COPY build_files /
COPY system_files /system_files

# Base Image
FROM ghcr.io/ublue-os/bazzite-gnome:stable
RUN dnf5 install -y plymouth-plugin-script librsvg2-tools && test -f /usr/lib64/plymouth/script.so
# Brand typeface (SIL OFL, from Fedora). Optional: if the package is
# unavailable the build continues and GNOME keeps its default font.
RUN dnf5 install -y rsms-inter-fonts || echo 'Inter font package unavailable; keeping the default font.'
COPY branding/ /tmp/mutsu-brand-assets/
COPY packaging/install-branding.sh /tmp/mutsu-install-branding.sh
RUN bash /tmp/mutsu-install-branding.sh && \
    rm -rf /tmp/mutsu-brand-assets /tmp/mutsu-install-branding.sh
## Other possible base images include:
# FROM ghcr.io/ublue-os/bazzite:testing
# FROM ghcr.io/ublue-os/aurora:stable
# FROM ghcr.io/ublue-os/bluefin-nvidia-open:stable
# 
# ... and so on, here are more base images
# Universal Blue Images: https://github.com/orgs/ublue-os/packages
# Fedora base image: quay.io/fedora/fedora-bootc:44
# CentOS base images: quay.io/centos-bootc/centos-bootc:stream10

### [IM]MUTABLE /opt
## Some bootable images, like Fedora, have /opt symlinked to /var/opt, in order to
## make it mutable/writable for users. However, some packages write files to this directory,
## thus its contents might be wiped out when bootc deploys an image, making it troublesome for
## some packages. Eg, google-chrome, docker-desktop.
##
## Uncomment the following line if one desires to make /opt immutable and be able to be used
## by the package manager.

# RUN rm /opt && mkdir /opt

### MODIFICATIONS
## make modifications desired in your image and install packages by modifying the build.sh script
## the following RUN directive does all the things required to run "build.sh" as recommended.

RUN --mount=type=bind,from=ctx,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/build.sh

### MUTSU OS DESKTOP
# Fedora 44 ships a GNOME 50-compatible Dash-to-Dock RPM. Make the
# Japandi floating dock part of the base image instead of optional.
RUN dnf5 install -y gnome-shell-extension-dash-to-dock && \
    test -s /usr/share/gnome-shell/extensions/dash-to-dock@micxgx.gmail.com/metadata.json

# Pin and stage the ai-desktop source via packaging/prepare-desktop.sh first.
# The source lives in the image itself; no per-user Git clone is required.
COPY packaging/desktop-source.env /usr/share/mutsu-os/build-info/desktop-source.env
COPY vendor/ai-desktop/src/ /usr/libexec/mutsu-os/src/
COPY packaging/mutsu-search /usr/bin/mutsu-search
COPY packaging/mutsu-first-login /usr/libexec/mutsu-os/mutsu-first-login
COPY packaging/setup-newelle-user.sh /usr/libexec/mutsu-os/setup-newelle-user.sh
COPY packaging/configure-newelle.py /usr/libexec/mutsu-os/configure-newelle.py
COPY packaging/wait-local-model.py /usr/libexec/mutsu-os/wait-local-model.py
COPY packaging/mutsu-welcome.service /usr/lib/systemd/user/mutsu-welcome.service
COPY packaging/mutsu-welcome.desktop /etc/xdg/autostart/mutsu-welcome.desktop
COPY packaging/mutsu-newelle-link.service /usr/lib/systemd/user/mutsu-newelle-link.service
COPY packaging/mutsu-accent.service /usr/lib/systemd/user/mutsu-accent.service
COPY packaging/mutsu-accent.sh /usr/libexec/mutsu-os/mutsu-accent.sh
COPY packaging/io.github.markymark5127.AIDesktop.desktop /usr/share/applications/io.github.markymark5127.AIDesktop.desktop
COPY packaging/90-mutsu-wallpaper.gschema.override /usr/share/glib-2.0/schemas/90-mutsu-wallpaper.gschema.override
COPY packaging/20-mutsu-shortcut.dconf /etc/dconf/db/mutsu.d/20-mutsu-shortcut
COPY packaging/30-mutsu-mac-defaults.dconf /etc/dconf/db/mutsu.d/30-mutsu-mac-defaults
COPY packaging/40-mutsu-japandi-defaults.dconf /etc/dconf/db/mutsu.d/40-mutsu-japandi-defaults
COPY packaging/50-mutsu-global-menu.dconf /etc/dconf/db/mutsu.d/50-mutsu-global-menu
COPY packaging/60-mutsu-kiwi.dconf /etc/dconf/db/mutsu.d/60-mutsu-kiwi
COPY packaging/configure-shortcut-defaults.sh /tmp/mutsu-configure-shortcut-defaults.sh
COPY vendor/ai-desktop/scripts/configure-newelle-key.sh /usr/share/mutsu-os/scripts/configure-newelle-key.sh
COPY vendor/ai-desktop/scripts/install-newelle-service.sh /usr/share/mutsu-os/scripts/install-newelle-service.sh
RUN chmod 0755 /usr/bin/mutsu-search /usr/libexec/mutsu-os/mutsu-first-login /usr/libexec/mutsu-os/setup-newelle-user.sh /usr/libexec/mutsu-os/mutsu-accent.sh && \
    install -d /etc/systemd/user/default.target.wants /etc/systemd/user/graphical-session.target.wants /etc/xdg/autostart && \
    ln -sfn /usr/lib/systemd/user/mutsu-welcome.service /etc/systemd/user/graphical-session.target.wants/mutsu-welcome.service && \
    ln -sfn /usr/lib/systemd/user/mutsu-newelle-link.service /etc/systemd/user/graphical-session.target.wants/mutsu-newelle-link.service && \
    ln -sfn /usr/lib/systemd/user/mutsu-accent.service /etc/systemd/user/graphical-session.target.wants/mutsu-accent.service && \
    rm -f /etc/xdg/autostart/mutsu-first-login.desktop && \
    python3 -m compileall -q /usr/libexec/mutsu-os/src && \
    glib-compile-schemas /usr/share/glib-2.0/schemas && \
    bash /tmp/mutsu-configure-shortcut-defaults.sh && \
    rm -f /tmp/mutsu-configure-shortcut-defaults.sh && \
    PYTHONPATH=/usr/libexec/mutsu-os/src /usr/bin/python3 -m aidesktop --help >/dev/null && \
    PYTHONPATH=/usr/libexec/mutsu-os/src /usr/bin/python3 -m aidesktop --setup-status >/dev/null

### MAC-STYLE SHORTCUTS
# keyd maps Mac-style shortcuts (system service, map baked in below).
# Super/Command+Space still opens Mutsu Search (see 20-mutsu-shortcut.dconf).
RUN dnf5 install -y gnome-tweaks
COPY packaging/keyd/default.conf /tmp/mutsu-keyd.conf
COPY packaging/install-mac-shortcuts.sh /tmp/mutsu-install-mac-shortcuts.sh
RUN bash /tmp/mutsu-install-mac-shortcuts.sh && \
    rm -f /tmp/mutsu-keyd.conf /tmp/mutsu-install-mac-shortcuts.sh
COPY packaging/set-mac-shortcuts.sh /usr/libexec/mutsu-os/set-mac-shortcuts.sh
# On-screen gamepad (tablet mode): virtual Xbox 360 pad via uinput, opened
# by the logged-in user (uaccess, same as Steam's own rule).
COPY packaging/mutsu-virtual-gamepad /usr/libexec/mutsu-os/mutsu-virtual-gamepad
COPY packaging/70-mutsu-uinput.rules /usr/lib/udev/rules.d/70-mutsu-uinput.rules
RUN chmod 0755 /usr/libexec/mutsu-os/set-mac-shortcuts.sh /usr/libexec/mutsu-os/mutsu-virtual-gamepad

### NEWELLE (baked in, no API key)
# Prepare on the Linux host with packaging/prepare-newelle.sh. No Flatpak
# deployment or nested bubblewrap runs inside this container build.
COPY vendor/newelle/flatpak.tar.zst /usr/share/mutsu-os/newelle/flatpak.tar.zst
COPY vendor/newelle/source.txt /usr/share/mutsu-os/build-info/newelle-source.txt
COPY vendor/newelle/gui-api/ /usr/share/mutsu-os/newelle-gui-api/
COPY packaging/install-newelle.sh /tmp/mutsu-install-newelle.sh
RUN dnf5 install -y ostree zstd && \
    bash /tmp/mutsu-install-newelle.sh && rm -f /tmp/mutsu-install-newelle.sh

# Fully local, pinned Qwen 3.5 9B through Ollama. No first-boot model pull.
COPY vendor/local-ai/runtime/ /usr/libexec/mutsu-os/ollama/
COPY vendor/local-ai/models/ /usr/share/mutsu-os/local-ai/models/
COPY vendor/local-ai/licenses/ /usr/share/licenses/mutsu-local-ai/
COPY vendor/local-ai/source.env /usr/share/mutsu-os/local-ai/source.env
COPY packaging/bundled-model.json /usr/share/mutsu-os/local-ai/bundled-model.json
COPY packaging/seed-local-model.sh /usr/libexec/mutsu-os/seed-local-model.sh
COPY packaging/mutsu-local-model.service /usr/lib/systemd/system/mutsu-local-model.service
COPY packaging/50-mutsu-local-model.rules /usr/share/polkit-1/rules.d/50-mutsu-local-model.rules
RUN dnf5 install -y libgomp numactl-libs && \
    chmod 0755 /usr/libexec/mutsu-os/seed-local-model.sh && \
    chmod -R a+rX /usr/share/mutsu-os/local-ai && \
    test -x /usr/libexec/mutsu-os/ollama/bin/ollama && \
    systemctl enable mutsu-local-model.service

### ADAPTIVE DESKTOP
COPY extensions/mutsu-adaptive@mutsu-os /tmp/mutsu-adaptive-src
COPY packaging/install-adaptive-extension.sh /tmp/mutsu-install-adaptive.sh
RUN bash /tmp/mutsu-install-adaptive.sh && \
    rm -rf /tmp/mutsu-adaptive-src /tmp/mutsu-install-adaptive.sh

### KIWI (panel window controls for any toolkit)
COPY extensions/kiwi@kemma /tmp/mutsu-kiwi-src
COPY packaging/install-kiwi.sh /tmp/mutsu-install-kiwi.sh
RUN bash /tmp/mutsu-install-kiwi.sh && \
    rm -rf /tmp/mutsu-kiwi-src /tmp/mutsu-install-kiwi.sh

### GLOBAL MENU (Mac-style File / Edit / View / Window bar)
# Vendored Global Menu for GNOME. Provides contextual menus next to the Mutsu logo.
# Installed before configure-native-desktop.py so it is present when the
# enabled-extensions list is compiled.
COPY extensions/globalmenu@ShiroOSL.github.io /tmp/mutsu-global-menu-src
COPY packaging/install-global-menu.sh /tmp/mutsu-install-global-menu.sh
RUN bash /tmp/mutsu-install-global-menu.sh && \
    rm -rf /tmp/mutsu-global-menu-src /tmp/mutsu-install-global-menu.sh

### TOUCHSHELL (tablet edge swipes and finger-tracked overview)
COPY extensions/touchshell@touchshell.com /tmp/mutsu-touchshell-src
COPY packaging/install-touchshell.sh /tmp/mutsu-install-touchshell.sh
RUN bash /tmp/mutsu-install-touchshell.sh && \
    rm -rf /tmp/mutsu-touchshell-src /tmp/mutsu-install-touchshell.sh

### NATIVE MUTSU GNOME SHELL (no per-user first-boot appearance script)
# Install the real system extension, compose upstream+Mutsu enabled extension
# defaults, and compile the high-priority user-overridable dconf database.
# GNOME loads Mutsu at the START of the first user session.
COPY extensions/mutsu-branding@mutsu-os /tmp/mutsu-branding-extension-src
COPY packaging/install-shell-branding.sh /tmp/mutsu-install-shell-branding.sh
COPY packaging/configure-native-desktop.py /tmp/mutsu-configure-native-desktop.py
RUN bash /tmp/mutsu-install-shell-branding.sh && \
    python3 /tmp/mutsu-configure-native-desktop.py && \
    rm -rf /tmp/mutsu-branding-extension-src /tmp/mutsu-install-shell-branding.sh \
           /tmp/mutsu-configure-native-desktop.py

# Validate the effective GNOME defaults with a clean HOME, *after* system
# config is compiled. This catches silent fallbacks to Bazzite at build time
# instead of asking users to discover them after installing the ISO.
COPY packaging/verify-native-desktop.py /tmp/mutsu-verify-native-desktop.py
RUN python3 /tmp/mutsu-verify-native-desktop.py && \
    rm -f /tmp/mutsu-verify-native-desktop.py

### MUTSU WELCOME ONLY
# Bazzite Portal (yafti) autostarts on first login. Hide it so Mutsu's
# welcome unit is the only setup the user sees.
COPY packaging/disable-bazzite-portal.sh /tmp/mutsu-disable-bazzite-portal.sh
RUN bash /tmp/mutsu-disable-bazzite-portal.sh && rm /tmp/mutsu-disable-bazzite-portal.sh

### MUTSU PORTAL
# Same yafti app, Mutsu content and Japandi colors. Manual only.
COPY branding/portal/ /tmp/mutsu-portal-assets/
COPY packaging/mutsu-portal /tmp/mutsu-portal
COPY packaging/mutsu-portal.desktop /tmp/mutsu-portal.desktop
COPY packaging/mutsu-updater.desktop /tmp/mutsu-updater.desktop
COPY packaging/mutsu-documentation.desktop /tmp/mutsu-documentation.desktop
COPY packaging/install-mutsu-portal.sh /tmp/mutsu-install-portal.sh
RUN bash /tmp/mutsu-install-portal.sh && \
    rm -rf /tmp/mutsu-portal-assets /tmp/mutsu-portal \
           /tmp/mutsu-portal.desktop /tmp/mutsu-install-portal.sh

### Guarded Mutsu Plymouth for bootc/OSTree
# Check original vendor initramfs first. Regenerate only a generic candidate
# with explicit ostree + plymouth (+ bootc if present). Validate OSTree root
# and logo before replacing it. Fresh installed VM boot tests still required.
COPY packaging/verify-upstream-initramfs.sh /tmp/mutsu-verify-initramfs.sh
COPY packaging/rebuild-mutsu-initramfs.sh /tmp/mutsu-rebuild-initramfs.sh
RUN bash /tmp/mutsu-verify-initramfs.sh && \
    bash /tmp/mutsu-rebuild-initramfs.sh && \
    rm /tmp/mutsu-verify-initramfs.sh /tmp/mutsu-rebuild-initramfs.sh

### NATIVE MUTSU TERMINAL
# Replace the inherited Bazzite welcome, fastfetch display and default host
# at image build time. Preserve upstream package IDs, hooks and user configs.
COPY branding/terminal/ /tmp/mutsu-terminal-assets/
COPY packaging/install-terminal-branding.sh /tmp/mutsu-install-terminal-branding.sh
COPY packaging/ensure-mutsu-hostname.sh /usr/libexec/mutsu-os/ensure-mutsu-hostname.sh
COPY packaging/mutsu-hostname.service /usr/lib/systemd/system/mutsu-hostname.service
# Live USB only: passwordless liveuser with automatic login (no-op installed).
COPY packaging/live-session-setup.sh /usr/libexec/mutsu-os/live-session-setup.sh
COPY packaging/mutsu-live-session.service /usr/lib/systemd/system/mutsu-live-session.service
COPY packaging/mutsu-flatpak-preinstall.service /usr/lib/systemd/system/mutsu-flatpak-preinstall.service
RUN bash /tmp/mutsu-install-terminal-branding.sh && \
    chmod 0755 /usr/libexec/mutsu-os/ensure-mutsu-hostname.sh /usr/libexec/mutsu-os/live-session-setup.sh && \
    systemctl enable mutsu-hostname.service mutsu-live-session.service mutsu-flatpak-preinstall.service && \
    test -s /usr/share/flatpak/preinstall.d/mutsu-os.preinstall && \
    rm -rf /tmp/mutsu-terminal-assets /tmp/mutsu-install-terminal-branding.sh

### USER-FACING MUTSU IDENTITY
# Clear inherited Bazzite first-run, wallpaper choices, and update launcher.
# This does not alter bootc/OSTree technical IDs or user home directories.
COPY packaging/mutsu-updater /usr/bin/mutsu-updater
COPY packaging/mutsu-branding-doctor /usr/bin/mutsu-branding-doctor
COPY packaging/run-mutsu-update.sh /usr/libexec/mutsu-os/run-mutsu-update.sh
COPY packaging/install-remaining-branding.sh /tmp/mutsu-install-remaining-branding.sh
COPY packaging/brand-just-recipes.py /tmp/mutsu-brand-just-recipes.py
RUN chmod 0755 /usr/bin/mutsu-updater /usr/bin/mutsu-branding-doctor /usr/libexec/mutsu-os/run-mutsu-update.sh && \
    bash /tmp/mutsu-install-remaining-branding.sh && \
    python3 /tmp/mutsu-brand-just-recipes.py && \
    rm -f /tmp/mutsu-install-remaining-branding.sh /tmp/mutsu-brand-just-recipes.py

# Fail if a fresh installation retains visible Bazzite/Fedora cosmetics.
COPY packaging/verify-visible-branding.py /tmp/mutsu-verify-visible-branding.py
RUN python3 /tmp/mutsu-verify-visible-branding.py && \
    rm -f /tmp/mutsu-verify-visible-branding.py

### LINTING
## Verify final image and contents are correct.
RUN bootc container lint
