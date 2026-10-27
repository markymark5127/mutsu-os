### MUTSU WELCOME ONLY
# Bazzite Portal (yafti) autostarts on first login. Hide it so Mutsu's
# welcome wizard is the only setup the user sees.
COPY packaging/disable-bazzite-portal.sh /tmp/mutsu-disable-bazzite-portal.sh
RUN bash /tmp/mutsu-disable-bazzite-portal.sh && rm /tmp/mutsu-disable-bazzite-portal.sh