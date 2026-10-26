#!/usr/bin/env bash
# Preinstall Newelle so the Mutsu helper is present on first boot.
# Does not configure a model or API key. The wizard still handles that.
set -euo pipefail

if ! command -v flatpak >/dev/null 2>&1; then
  echo >&2 "WARNING: flatpak not available; Newelle will not be preinstalled"
  exit 0
fi

flatpak remote-add --system --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo || true

if flatpak install --system --noninteractive --no-deploy flathub io.github.qwersyk.Newelle; then
  echo "Newelle staged for first-boot deploy."
else
  echo >&2 "WARNING: Newelle Flatpak install failed; image build continues"
fi
