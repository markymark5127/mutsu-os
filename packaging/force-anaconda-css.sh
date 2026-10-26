#!/usr/bin/env bash
# Force Anaconda to load the Mutsu product stylesheet.
# Run inside the image build after branding files are installed.
# Safe no-op if Anaconda files are absent.
set -euo pipefail

css=/usr/share/anaconda/pixmaps/mutsu.css
gtk=/usr/share/anaconda/anaconda-gtk.css
product=/usr/share/anaconda/pixmaps/mutsu-product.css

if [[ ! -s "$css" ]]; then
  echo "Mutsu Anaconda CSS not present; skipping force."
  exit 0
fi

# Some Anaconda versions pick up a product CSS by this name.
ln -sf mutsu.css "$product" || true

# If the base GTK CSS exists, append an import so the Mutsu rules win.
if [[ -s "$gtk" ]] && ! grep -q 'mutsu.css' "$gtk"; then
  printf '\n/* Mutsu OS product branding */\n@import url("pixmaps/mutsu.css");\n' >> "$gtk"
  echo "Appended Mutsu CSS import to anaconda-gtk.css"
else
  echo "anaconda-gtk.css missing or already imports Mutsu CSS"
fi
