#!/usr/bin/env bash
# Baked into the Mutsu image; no user dotfiles or login-time mutations.
set -euo pipefail

src=/tmp/mutsu-terminal-assets
for name in logo.txt fastfetch.jsonc motd.md; do
  [[ -s "$src/$name" ]] || { echo >&2 "Missing terminal branding: $name"; exit 1; }
done

# Keep the terminal assets under Mutsu's own namespace.
install -Dm0644 "$src/logo.txt" /usr/share/mutsu-os/terminal/logo.txt
install -Dm0644 "$src/fastfetch.jsonc" /usr/share/mutsu-os/terminal/fastfetch.jsonc

# command fastfetch (without an alias) also picks up Mutsu by default.
# A user's ~/.config/fastfetch/config.jsonc can still override this.
install -Dm0644 "$src/fastfetch.jsonc" /etc/xdg/fastfetch/config.jsonc

# Universal Blue's existing bash/fish MOTD hooks render these templates.
# Replace only the visible text; keep hooks, boot-status reporting and the
# toggle-user-motd opt-out intact. Swedish locales must not fall back to a
# vendor-branded template while awaiting a translated Mutsu version.
install -Dm0644 "$src/motd.md" /usr/share/ublue-os/motd/template.md
install -Dm0644 "$src/motd.md" /usr/share/ublue-os/motd/template.sv.md

# Bazzite defines its own aliases earlier in profile.d and fish conf.d.
# Late vendor aliases replace only the display config; do not change the
# upstream command, RPMs, update paths, or scripts.
cat > /etc/profile.d/zz-mutsu-fastfetch.sh <<'BASH'
# Mutsu terminal display (after the inherited Bazzite aliases).
alias fastfetch='/usr/bin/fastfetch -c /usr/share/mutsu-os/terminal/fastfetch.jsonc'
alias neofetch='/usr/bin/fastfetch -c /usr/share/mutsu-os/terminal/fastfetch.jsonc'
alias neowofetch='/usr/bin/fastfetch -c /usr/share/mutsu-os/terminal/fastfetch.jsonc'
BASH
chmod 0644 /etc/profile.d/zz-mutsu-fastfetch.sh

install -d -m0755 /usr/share/fish/vendor_conf.d
cat > /usr/share/fish/vendor_conf.d/zz-mutsu-fastfetch.fish <<'FISH'
# Mutsu terminal display (after the inherited Bazzite aliases).
alias fastfetch='/usr/bin/fastfetch -c /usr/share/mutsu-os/terminal/fastfetch.jsonc'
alias neofetch='/usr/bin/fastfetch -c /usr/share/mutsu-os/terminal/fastfetch.jsonc'
alias neowofetch='/usr/bin/fastfetch -c /usr/share/mutsu-os/terminal/fastfetch.jsonc'
FISH
chmod 0644 /usr/share/fish/vendor_conf.d/zz-mutsu-fastfetch.fish

printf 'Mutsu terminal welcome and fastfetch branding installed.\n'
