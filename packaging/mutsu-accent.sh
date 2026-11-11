#!/usr/bin/env bash
# Mutsu's sage accent for GTK apps. GNOME's accent list has no sage, so
# libadwaita (GTK 4) and adw-gtk3 apps get it from a small, clearly marked
# block in the user's gtk.css. Run at each login; idempotent; leaves the
# rest of the file (and Kiwi's own block) alone. Remove the block to opt out
# for good: create ~/.config/mutsu/no-sage-accent.
set -euo pipefail
[[ -e "$HOME/.config/mutsu/no-sage-accent" ]] && exit 0
start='/* mutsu-accent:start (managed by Mutsu OS) */'
end='/* mutsu-accent:end */'
write_block() {
  local file="$1" body="$2" tmp
  mkdir -p "$(dirname "$file")"
  touch "$file"
  tmp="$(mktemp)"
  # Drop any previous Mutsu block, keep everything else as it was.
  awk -v s="$start" -v e="$end" '
    $0 == s {skip = 1; next}
    $0 == e {skip = 0; next}
    !skip {print}
  ' "$file" > "$tmp"
  # At the end: GTK wants @import lines (Kiwi's) before any rules.
  { cat "$tmp"; printf '%s\n%s\n%s\n' "$start" "$body" "$end"; } > "$file"
  rm -f "$tmp"
}
write_block "$HOME/.config/gtk-4.0/gtk.css" ':root {
  --accent-bg-color: #7F9A82;
  --accent-fg-color: #ffffff;
}'
write_block "$HOME/.config/gtk-3.0/gtk.css" '@define-color accent_bg_color #7F9A82;
@define-color accent_fg_color #ffffff;
@define-color accent_color #5E7A62;'
