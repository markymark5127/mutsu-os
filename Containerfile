### MUTSU WELCOME ONLY
# Bazzite Portal (yafti) autostarts on first login. Hide it so Mutsu's
# welcome wizard is the only setup the user sees.
COPY packaging/disable-bazzite-portal.sh /tmp/mutsu-disable-bazzite-portal.sh
RUN bash /tmp/mutsu-disable-bazzite-portal.sh && rm /tmp/mutsu-disable-bazzite-portal.sh

### MUTSU PORTAL
# Same yafti app, Mutsu content and Japandi colors. Manual only.
COPY branding/portal/ /tmp/mutsu-portal-assets/
COPY packaging/mutsu-portal /tmp/mutsu-portal
COPY packaging/mutsu-portal.desktop /tmp/mutsu-portal.desktop
COPY packaging/install-mutsu-portal.sh /tmp/mutsu-install-portal.sh
RUN bash /tmp/mutsu-install-portal.sh && \
    rm -rf /tmp/mutsu-portal-assets /tmp/mutsu-portal \
           /tmp/mutsu-portal.desktop /tmp/mutsu-install-portal.sh