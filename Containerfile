# Allow build scripts to be referenced without being copied into the final image
FROM scratch AS ctx
COPY build_files /
COPY system_files /system_files

# Base Image
FROM ghcr.io/ublue-os/bazzite-gnome:stable
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
# Pin and stage the ai-desktop source via packaging/prepare-desktop.sh first.
# The source lives in the image itself; no per-user Git clone is required.
COPY vendor/ai-desktop/src/ /usr/libexec/mutsu-os/src/
COPY packaging/mutsu-search /usr/bin/mutsu-search
COPY packaging/mutsu-first-login /usr/libexec/mutsu-os/mutsu-first-login
COPY packaging/io.github.markymark5127.AIDesktop.desktop /usr/share/applications/io.github.markymark5127.AIDesktop.desktop
COPY packaging/mutsu-first-login.desktop /etc/xdg/autostart/mutsu-first-login.desktop
COPY packaging/90-mutsu-wallpaper.gschema.override /usr/share/glib-2.0/schemas/90-mutsu-wallpaper.gschema.override
COPY packaging/20-mutsu-shortcut.dconf /etc/dconf/db/mutsu.d/20-mutsu-shortcut
COPY packaging/configure-shortcut-defaults.sh /tmp/mutsu-configure-shortcut-defaults.sh
COPY vendor/ai-desktop/scripts/configure-newelle-key.sh /usr/share/mutsu-os/scripts/configure-newelle-key.sh
COPY vendor/ai-desktop/scripts/install-newelle-service.sh /usr/share/mutsu-os/scripts/install-newelle-service.sh
RUN chmod 0755 /usr/bin/mutsu-search /usr/libexec/mutsu-os/mutsu-first-login && \
    python3 -m compileall -q /usr/libexec/mutsu-os/src && \
    glib-compile-schemas /usr/share/glib-2.0/schemas && \
    bash /tmp/mutsu-configure-shortcut-defaults.sh && \
    rm -f /tmp/mutsu-configure-shortcut-defaults.sh

### ADAPTIVE DESKTOP
COPY extensions/mutsu-adaptive@mutsu-os /tmp/mutsu-adaptive-src
COPY packaging/install-adaptive-extension.sh /tmp/mutsu-install-adaptive.sh
RUN bash /tmp/mutsu-install-adaptive.sh && \
    rm -rf /tmp/mutsu-adaptive-src /tmp/mutsu-install-adaptive.sh

### LINTING
## Verify final image and contents are correct.
RUN bootc container lint
