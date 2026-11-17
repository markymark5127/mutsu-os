#!/bin/bash
# Make Mutsu OS updates signature-checked.
#
# CI signs every pushed image with cosign (SIGNING_SECRET, see build.yml);
# this teaches the installed system to check those signatures: the public
# key, a sigstore lookup rule for the repository, and a policy.json entry
# that accepts ghcr.io/markymark5127/mutsu-os only when signed by that key.
# Without it the base image's policy falls back to insecureAcceptAnything
# for any docker:// image that isn't Universal Blue's.
#
# Usage: install-image-trust.sh <cosign.pub>
set -euo pipefail

key_src=${1:?usage: install-image-trust.sh <cosign.pub>}
repo=ghcr.io/markymark5127/mutsu-os
key=/etc/pki/containers/mutsu-os.pub
policy=/etc/containers/policy.json

grep -q 'BEGIN PUBLIC KEY' "$key_src"
install -Dm0644 "$key_src" "$key"

install -d /etc/containers/registries.d
cat > /etc/containers/registries.d/mutsu-os.yaml <<EOF
docker:
  ${repo}:
    use-sigstore-attachments: true
EOF

python3 - "$policy" "$repo" "$key" <<'EOF'
import json, sys
path, repo, key = sys.argv[1:]
with open(path, encoding="utf-8") as fh:
    policy = json.load(fh)
policy.setdefault("transports", {}).setdefault("docker", {})[repo] = [{
    "type": "sigstoreSigned",
    "keyPaths": [key],
    "signedIdentity": {"type": "matchRepository"},
}]
with open(path, "w", encoding="utf-8") as fh:
    json.dump(policy, fh, indent=4)
    fh.write("\n")
EOF

# The whole point: Mutsu images must not be accepted unsigned.
python3 - "$policy" "$repo" <<'EOF'
import json, sys
path, repo = sys.argv[1:]
entry = json.load(open(path, encoding="utf-8"))["transports"]["docker"][repo]
assert entry[0]["type"] == "sigstoreSigned", entry
EOF
