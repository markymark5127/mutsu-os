#!/usr/bin/env bash
# Only for Containerfile RUN during a Mutsu OS derived OCI image build.
# NEVER run this directly on an installed Fedora/Bazzite operating system.
set -euo pipefail

if [[ ! -d /tmp/mutsu-brand-assets/icons ]] || [[ ! -f /usr/lib/os-release ]]; then
  echo >&2 "This script must run inside the Mutsu image build context."
  exit 1
fi

brand=/tmp/mutsu-brand-assets
symbol="$brand/icons/mutsu-logo-symbol.svg"
wordmark="$brand/icons/mutsu-logo-wordmark.svg"
if [[ ! -s "$symbol" || ! -s "$wordmark" ]]; then
  echo >&2 "Mutsu OS build needs mutsu-logo-symbol.svg and mutsu-logo-wordmark.svg in branding/icons/."
  exit 1
fi

# Install without deleting Fedora/Bazzite icons or renaming RPMs/services.
install -Dm0644 "$symbol" /usr/share/icons/hicolor/scalable/apps/mutsu-os-logo.svg
install -Dm0644 "$symbol" /usr/share/icons/hicolor/scalable/apps/io.github.markymark5127.AIDesktop.svg
# Existing Mutsu AI search resolves this exact path as a fallback for its
# assistant icon; the branding and application source remain separate repos.
install -Dm0644 "$symbol" /usr/share/pixmaps/mutsu/mutsu-logo-symbol.svg
install -Dm0644 "$wordmark" /usr/share/pixmaps/mutsu/mutsu-logo-wordmark.svg
if [[ -s "$brand/icons/mutsu-logo-symbolic.svg" ]]; then
  install -Dm0644 "$brand/icons/mutsu-logo-symbolic.svg" \
    /usr/share/icons/hicolor/symbolic/apps/mutsu-os-symbolic.svg
fi

for name in mutsu-japandi-4k.png mutsu-cyberpunk-4k.png; do
  if [[ ! -s "$brand/wallpapers/$name" ]]; then
    echo >&2 "Missing Mutsu wallpaper: $name"
    exit 1
  fi
  install -Dm0644 "$brand/wallpapers/$name" "/usr/share/backgrounds/mutsu/$name"
done

# Stage additional approved Mutsu artwork and palette sources for future
# user-controlled Shell/theme integration. These are data assets ONLY:
# DO NOT automatically apply global Shell CSS or alter GNOME enabled extensions.
for asset in "$brand"/icons/mutsu-logo-*.svg \
             "$brand"/icons/mutsu-wordmark-*.svg \
             "$brand"/icons/mutsu-ai.svg \
             "$brand"/icons/mutsu-app-grid.svg; do
  [[ -s "$asset" ]] || continue
  install -Dm0644 "$asset" "/usr/share/mutsu-os/branding/icons/${asset##*/}"
done
for theme in japandi cyberpunk; do
  install -Dm0644 "$brand/themes/$theme.json" \
    "/usr/share/mutsu-os/branding/themes/$theme.json"
  install -Dm0644 "$brand/shell/$theme.css" \
    "/usr/share/mutsu-os/branding/shell/$theme.css"
done

# Anaconda live installer sidebar branding (Japandi sage).
# These override the default Fedora/Bazzite blue banner when the ISO is built
# from this image. Missing files are a warning, not a hard failure.
installer="$brand/installer"
if [[ -d "$installer" ]]; then
  install -d -m 0755 /usr/share/anaconda/pixmaps
  for f in sidebar-bg.png sidebar-logo.png topbar-bg.png mutsu.css; do
    if [[ -s "$installer/$f" ]]; then
      install -Dm0644 "$installer/$f" "/usr/share/anaconda/pixmaps/$f"
    else
      echo >&2 "WARNING: missing installer branding file $f (ISO sidebar will use upstream)"
    fi
  done
  # Best-effort: drop a product CSS name Anaconda often picks up.
  if [[ -s /usr/share/anaconda/pixmaps/mutsu.css ]]; then
    ln -sf mutsu.css /usr/share/anaconda/pixmaps/mutsu-product.css || true
  fi
else
  echo >&2 "WARNING: branding/installer/ not present; Anaconda will keep upstream sidebar."
fi

# GNOME About and similar clients read the cosmetic name and logo from
# os-release. Keep ID, ID_LIKE, VERSION_ID and related Bazzite compatibility
# metadata intact; these identifiers are used by packaging/updating.
python3 - <<'PY'
from pathlib import Path

path = Path("/usr/lib/os-release")
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
patch = {
    "NAME": '"Mutsu OS"',
    "PRETTY_NAME": '"Mutsu OS"',
    "LOGO": "mutsu-os-logo",
}
seen: set[str] = set()
output = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in patch:
        if key not in seen:
            output.append(f"{key}={patch[key]}\n")
            seen.add(key)
    else:
        output.append(line)
for key, value in patch.items():
    if key not in seen:
        output.append(f"{key}={value}\n")
path.write_text("".join(output), encoding="utf-8")
PY

# GDM login is controlled by its own system dconf database, not by the
# logged-in user's wallpaper/appearance setting. This is the vendor-backed
# dconf approach; do not force-restart GDM in an image build.
if command -v dconf >/dev/null 2>&1; then
  install -d -m 0755 /etc/dconf/db/gdm.d
  cat > /etc/dconf/db/gdm.d/90-mutsu-logo <<'DCONF'
[org/gnome/login-screen]
logo='/usr/share/pixmaps/mutsu/mutsu-logo-wordmark.svg'
DCONF
  dconf update
else
  echo >&2 "WARNING: dconf unavailable; Mutsu GDM logo must be configured separately."
fi

# System boot splash, installer/ISO artwork, and Shell panel icons require
# separate upstream-version-checked integration. Do not overwrite random
# upstream Bazzite files or regenerate initramfs inside an unknown image.
printf 'Mutsu OS image branding installed: GNOME logo, OS display name, login logo, wallpapers, and Anaconda sidebar.\n'
