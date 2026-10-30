#!/usr/bin/env bash
# Host build: official Ollama runtime + verified Qwen 3.5 9B model store.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/packaging/local-model.env"
destination="$repo_root/vendor/local-ai"
fingerprint="$(cat "$repo_root/packaging/local-model.env" "$repo_root/packaging/prepare-local-model.sh" \
  "$repo_root/packaging/fetch-ollama-model.py" "$repo_root/packaging/wait-local-model.py" | sha256sum | cut -d' ' -f1)"
if [[ -s "$destination/.complete" && "$(cat "$destination/.complete")" == "$fingerprint" ]]; then
  test -x "$destination/runtime/bin/ollama"
  test -s "$destination/models/manifests/registry.ollama.ai/library/qwen3.5/9b"
  exit 0
fi
[[ ! -e "$destination" ]] || { echo >&2 'Move the stale vendor/local-ai payload aside before rebuilding.'; exit 1; }
case "$(uname -m)" in
  x86_64) arch=amd64; checksum="$MUTSU_OLLAMA_AMD64_SHA256" ;;
  aarch64) arch=arm64; checksum="$MUTSU_OLLAMA_ARM64_SHA256" ;;
  *) echo >&2 'The offline model runtime supports x86_64 and aarch64.'; exit 1 ;;
esac
staging="$(mktemp -d /var/tmp/mutsu-local-model.XXXXXXXX)"
server_pid=''
cleanup() { if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi; rm -rf -- "$staging"; }
trap cleanup EXIT
curl -fL --retry 3 "https://github.com/ollama/ollama/releases/download/${MUTSU_OLLAMA_VERSION}/ollama-linux-${arch}.tar.zst" -o "$staging/engine.tar.zst"
printf '%s  %s\n' "$checksum" "$staging/engine.tar.zst" | sha256sum -c -
mkdir "$staging/runtime" "$staging/home"
# Tablet CPU runtime; optional GPU runtimes are not required for local AI.
tar --zstd -xf "$staging/engine.tar.zst" -C "$staging/runtime" \
  --exclude='*/cuda*' --exclude='*/rocm*' --exclude='*/vulkan*' --exclude='*/mlx*'
python3 "$repo_root/packaging/fetch-ollama-model.py" "$staging" "$MUTSU_MODEL_MANIFEST"
curl -fL --retry 3 "https://raw.githubusercontent.com/ollama/ollama/${MUTSU_OLLAMA_VERSION}/LICENSE" -o "$staging/licenses/Ollama-LICENSE"
# Native-host sandbox hides the real home, so the smoke test cannot use or
# package a developer's existing Ollama keys, configuration or personal models.
OLLAMA_HOST=127.0.0.1:11439 OLLAMA_MODELS="$staging/models" OLLAMA_NO_CLOUD=1 \
  bwrap --unshare-user --unshare-pid --ro-bind / / --dev-bind /dev /dev --proc /proc \
    --tmpfs /tmp --bind "$staging/home" "$HOME" --bind "$staging" "$staging" \
    "$staging/runtime/bin/ollama" serve > "$staging/model-test.log" 2>&1 &
server_pid=$!
if ! python3 "$repo_root/packaging/wait-local-model.py" --url http://127.0.0.1:11439 --smoke; then
  cat "$staging/model-test.log" >&2
  exit 1
fi
kill "$server_pid"; wait "$server_pid" || true; server_pid=''
mkdir -p "$destination"
cp -a "$staging/runtime" "$staging/models" "$staging/licenses" "$destination/"
cp "$repo_root/packaging/local-model.env" "$destination/source.env"
printf '%s\n' "$fingerprint" > "$destination/.complete"
