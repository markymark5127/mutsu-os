#!/usr/bin/env bash
# Build a Fedora 44 Anaconda live ISO with the exact Mutsu OS payload.
# No unattended partitioning or disk erasure is configured.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
payload="${1:?Usage: build-installer-iso.sh OCI_IMAGE_REF OUTPUT_DIR}"
output="${2:?Usage: build-installer-iso.sh OCI_IMAGE_REF OUTPUT_DIR}"
builder="${IB_IMAGE:-ghcr.io/osbuild/image-builder-cli:latest}"
installer=localhost/mutsu-os-live-installer:ci
case "$payload" in
  *'@sha256:'*|localhost/*:*) ;;
  *) echo >&2 "Installer payload must be an immutable digest or local image tag"; exit 2 ;;
esac
for cmd in sudo podman realpath; do
  command -v "$cmd" >/dev/null || { echo >&2 "Missing build prerequisite: $cmd"; exit 1; }
done
install -d "$output"
output="$(realpath "$output")"
test -s "$root/packaging/installer/iso.yaml"
test -s "$root/branding/installer/.buildstamp"
if ! sudo podman image exists "$payload"; then
  sudo podman pull "$payload"
fi
# Image Builder embeds this payload by copying it into the live ISO's local
# containers-storage. A SHA-based *destination* fails when skopeo must change
# the layer representation; give the copy a writable name without changing
# the exact digest-pinned image used as its input.
payload_alias="ghcr.io/markymark5127/mutsu-os:offline-installer-payload"
sudo podman tag "$payload" "$payload_alias"
original_id="$(sudo podman image inspect "$payload" --format '{{.Id}}')"
alias_id="$(sudo podman image inspect "$payload_alias" --format '{{.Id}}')"
[[ -n "$original_id" && "$original_id" == "$alias_id" ]] || {
  echo >&2 "Refusing to embed an alias that differs from the pinned Mutsu payload"
  exit 1
}
echo "Embedding Mutsu payload $payload (same local image ID as $payload_alias)"
sudo podman build --pull=newer \
  --build-arg "MUTSU_PAYLOAD_SOURCE_REF=$payload_alias" \
  --build-arg "MUTSU_PAYLOAD_TARGET_REF=$payload" \
  --file "$root/packaging/installer/Containerfile" \
  --tag "$installer" "$root"
sudo podman run --rm --entrypoint /bin/sh \
  --env "EXPECTED_BOOTC_LINE=bootc --source-imgref containers-storage:$payload_alias --target-imgref $payload" \
  "$installer" -ec '
  test -s /usr/share/anaconda/.buildstamp
  grep -qx "Product=Mutsu OS" /usr/share/anaconda/.buildstamp
  grep -Fqx -- "$EXPECTED_BOOTC_LINE" /usr/share/anaconda/interactive-defaults.ks
  test -s /usr/lib/image-builder/bootc/iso.yaml
  python3 /usr/libexec/mutsu-patch-anaconda-offline-network.py --verify
  grep -Fq "inst.graphical selinux=0" /usr/lib/image-builder/bootc/iso.yaml
  test -f /usr/bin/lspci
  test -x /usr/bin/bootc
  test -x /usr/libexec/mutsu-bootc-original
  bash -n /usr/bin/bootc
  grep -Fq '\''mount --bind "$scratch" /var/tmp'\'' /usr/bin/bootc
  grep -Fq '\''lost+found'\'' /usr/bin/bootc
'
sudo podman run --rm --privileged \
  --security-opt label=type:unconfined_t \
  --volume /var/lib/containers/storage:/var/lib/containers/storage \
  --volume "$output:/output" \
  "$builder" build \
  --output-dir /output \
  --bootc-ref "$installer" \
  --bootc-installer-payload-ref "$payload_alias" \
  --bootc-default-fs ext4 \
  generic-iso
echo "Mutsu interactive installer ISO created under $output"
