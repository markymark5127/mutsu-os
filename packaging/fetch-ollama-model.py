#!/usr/bin/env python3
"""Build-time download of a pinned public Ollama model into an isolated store."""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

REGISTRY = 'https://registry.ollama.ai/v2/library/qwen3.5'


def verified_download(url, path, digest, expected_size=None):
    expected = digest.removeprefix('sha256:')
    if not re.fullmatch('[a-f0-9]{64}', expected):
        raise ValueError('Invalid model content digest')
    temporary = path.with_suffix('.partial')
    hasher = hashlib.sha256()
    size = 0
    try:
        request = Request(url, headers={'Accept': 'application/vnd.docker.distribution.manifest.v2+json'})
        with urlopen(request, timeout=300) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                hasher.update(chunk)
                size += len(chunk)
        if hasher.hexdigest() != expected or (expected_size is not None and size != expected_size):
            raise ValueError('Downloaded model checksum or size did not match its pinned manifest')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def fetch_model(destination, manifest_digest):
    destination.mkdir(parents=True, exist_ok=True)
    manifest = destination / 'manifest.json'
    verified_download(REGISTRY + '/manifests/' + manifest_digest, manifest, manifest_digest)
    data = json.loads(manifest.read_text(encoding='utf-8'))
    store = destination / 'models'
    blobs = store / 'blobs'
    blobs.mkdir(parents=True, exist_ok=True)
    licenses = destination / 'licenses'
    licenses.mkdir(exist_ok=True)
    for item in [data['config'], *data['layers']]:
        digest = item['digest']
        path = blobs / digest.replace(':', '-')
        verified_download(REGISTRY + '/blobs/' + digest, path, digest, item['size'])
        if item['mediaType'] == 'application/vnd.ollama.image.license':
            (licenses / 'Qwen-3.5-LICENSE').write_bytes(path.read_bytes())
    model_ref = store / 'manifests/registry.ollama.ai/library/qwen3.5/9b'
    model_ref.parent.mkdir(parents=True, exist_ok=True)
    model_ref.write_bytes(manifest.read_bytes())


if __name__ == '__main__':
    fetch_model(Path(sys.argv[1]), sys.argv[2])
