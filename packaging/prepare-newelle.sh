#!/usr/bin/env bash
# Run on the Linux build HOST, never in an OCI RUN instruction.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destination="$repo_root/vendor/newelle"
fingerprint="$(cat "$repo_root/packaging/prepare-newelle.sh" \
  "$repo_root/packaging/build-newelle-dependencies.sh" | sha256sum | cut -d' ' -f1)"
if [[ -s "$destination/flatpak.tar.zst" && -s "$destination/gui-api/runtime.json" &&
      -s "$destination/source.txt" && -s "$destination/.complete" &&
      "$(cat "$destination/.complete")" == "$fingerprint" ]]; then
  echo 'Using the prepared offline Newelle payload.'
  exit 0
fi
if [[ -e "$destination" ]]; then
  echo >&2 'vendor/newelle is incomplete. Move it aside before preparing again.'
  exit 1
fi
for tool in flatpak tar zstd python3 curl; do
  command -v "$tool" >/dev/null || { echo >&2 "Missing host build tool: $tool"; exit 1; }
done
staging="$(mktemp -d /var/tmp/mutsu-newelle-host.XXXXXXXX)"
trap 'rm -rf -- "$staging"' EXIT
app=io.github.qwersyk.Newelle
# Only this dedicated installation is archived. Never copy personal apps,
# permissions, Newelle settings, credentials, models or chat history.
export FLATPAK_USER_DIR="$staging/flatpak"
curl --fail --location --retry 3 https://dl.flathub.org/repo/flathub.flatpakrepo \
  --output "$staging/flathub.flatpakrepo"
flatpak remote-add --user --if-not-exists flathub "$staging/flathub.flatpakrepo"
# Keep the archive self-contained, including Locale extensions. Partial
# locale commits cannot be imported as complete OSTree objects offline.
flatpak config --user --set languages '*'
flatpak install --user --noninteractive --assumeyes flathub "$app"
bash "$repo_root/packaging/build-newelle-dependencies.sh" "$staging/gui-api"
flatpak list --user --columns=ref | while IFS= read -r ref; do
  commit="$(flatpak info --user --show-commit "$ref")"
  printf '%s\t%s\n' "$ref" "$commit"
done > "$staging/source.txt"
test -s "$staging/source.txt"
tar --zstd -cf "$staging/flatpak.tar.zst" -C "$staging" flatpak flathub.flatpakrepo
mkdir -p "$destination/gui-api"
cp -a "$staging/gui-api/." "$destination/gui-api/"
cp "$staging/source.txt" "$staging/flatpak.tar.zst" "$destination/"
printf '%s\n' "$fingerprint" > "$destination/.complete"
echo "Prepared offline Newelle payload: $destination"
