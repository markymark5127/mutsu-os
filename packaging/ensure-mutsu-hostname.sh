#!/usr/bin/env bash
# On an upgraded installation /etc/hostname can retain the Bazzite default.
# Never overwrite a user-selected hostname.
set -euo pipefail

[[ -r /etc/hostname ]] || exit 0
current=''
IFS= read -r current < /etc/hostname || true
case "$current" in
  bazzite|bazzite.localdomain)
    /usr/bin/hostnamectl set-hostname mutsu
    ;;
esac
