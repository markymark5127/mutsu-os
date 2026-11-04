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
sudo podman build --pull=newer \
  --build-arg "MUTSU_PAYLOAD_REF=$payload" \
  --file "$root/packaging/installer/Containerfile" \
  --tag "$installer" "$root"
sudo podman run --rm --entrypoint /bin/sh "$installer" -ec '
  test -s /usr/share/anaconda/.buildstamp
  grep -qx "Product=Mutsu OS" /usr/share/anaconda/.buildstamp
  grep -q "containers-storage:ghcr.io/markymark5127/mutsu-os@sha256:" \
    /usr/share/anaconda/interactive-defaults.ks
  test -s /usr/lib/image-builder/bootc/iso.yaml
'
sudo podman run --rm --privileged \
  --security-opt label=type:unconfined_t \
  --volume /var/lib/containers/storage:/var/lib/containers/storage \
  --volume "$output:/output" \
  "$builder" build \
  --output-dir /output \
  --bootc-ref "$installer" \
  --bootc-installer-payload-ref "$payload" \
  --bootc-default-fs ext4 \
  generic-iso
echo "Mutsu interactive installer ISO created under $output"
