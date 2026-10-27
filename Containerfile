COPY branding/ /tmp/mutsu-brand-assets/
COPY packaging/install-branding.sh /tmp/mutsu-install-branding.sh
RUN bash /tmp/mutsu-install-branding.sh && \
    rm -rf /tmp/mutsu-brand-assets /tmp/mutsu-install-branding.sh

### JAPANDI FIRST BOOT
# Bazzite's local.d wallpaper wins over gschema defaults. Override it.
COPY packaging/90-mutsu-japandi.dconf /tmp/mutsu-japandi.dconf
COPY packaging/install-japandi-defaults.sh /tmp/mutsu-install-japandi.sh
RUN bash /tmp/mutsu-install-japandi.sh && \
    rm -f /tmp/mutsu-japandi.dconf /tmp/mutsu-install-japandi.sh