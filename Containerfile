### Boot splash: Mutsu Plymouth in a generic initramfs
# Plymouth reads its theme from the initramfs, so leaving Bazzite's image
# in place keeps the Bazzite logo on the preparing-system screen.
# Rebuild generic (--no-hostonly) and refuse the image if OSTree prep is gone.
COPY packaging/rebuild-mutsu-initramfs.sh /tmp/mutsu-rebuild-initramfs.sh
RUN bash /tmp/mutsu-rebuild-initramfs.sh && rm /tmp/mutsu-rebuild-initramfs.sh