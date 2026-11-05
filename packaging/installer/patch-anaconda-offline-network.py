#!/usr/bin/env python3
"""Correct Fedora 44 Anaconda's hardcoded bootc network requirement.

The bootc source module reports network_required=True for every bootc
source, including an OCI image already embedded in the installer ISO.
Only Mutsu's exact, offline containers-storage payload is exempted.

This is deliberately a narrowly scoped, fail-closed build-time patch to
Anaconda's *installer environment*. It must never modify the installed
Mutsu desktop/container. Remove once upstream Anaconda handles local
bootc sources correctly.
"""

from __future__ import annotations

import argparse
import pathlib
import re

OFFLINE_IMAGE_REF = (
    "containers-storage:ghcr.io/markymark5127/mutsu-os:"
    "offline-installer-payload"
)
MATCHED_BODY = (
    '        # The Mutsu bootc image was embedded by Image Builder.\n'
    '        # A registry-backed or unknown image still requires networking.\n'
    '        return self.configuration.sourceImgRef != ' + repr(OFFLINE_IMAGE_REF)
)
PROPERTY_NAME = "    def network_required(self):"


def patch_source(source: str) -> str:
    """Patch one known upstream network_required property, or fail closed."""
    if source.count("class BootcSourceModule(") != 1:
        raise ValueError("Unexpected Anaconda BootcSourceModule layout")
    if source.count(PROPERTY_NAME) != 1:
        raise ValueError("Unexpected Anaconda bootc network_required layout")
    start = source.index(PROPERTY_NAME)
    end = source.find("\n    @property", start + len(PROPERTY_NAME))
    if end < 0:
        raise ValueError("Could not isolate bootc network_required property")

    block = source[start:end]
    if MATCHED_BODY in block:
        return source
    block, replacements = re.subn(
        r"(?m)^        return True$", MATCHED_BODY, block
    )
    if replacements != 1:
        raise ValueError(
            "Upstream Anaconda network_required behavior changed; "
            "refusing to patch a different implementation"
        )
    result = source[:start] + block + source[end:]
    compile(result, "anaconda-bootc.py", "exec")
    return result


def installed_module() -> pathlib.Path:
    matches = sorted(
        pathlib.Path("/usr").glob(
            "lib*/python*/site-packages/"
            "pyanaconda/modules/payloads/source/bootc/bootc.py"
        )
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one installed Anaconda bootc module, got {matches}"
        )
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--verify", action="store_true",
        help="Check that offline source detection is patched; do not modify",
    )
    args = parser.parse_args()
    path = installed_module()
    original = path.read_text(encoding="utf-8")
    patched = patch_source(original)
    if args.verify:
        if original != patched or MATCHED_BODY not in original:
            raise SystemExit("Anaconda offline-network patch is not present")
        print(f"Verified offline bootc source exception in {path}")
        return
    if original != patched:
        path.write_text(patched, encoding="utf-8")
    print(f"Installed scoped offline bootc source exception in {path}")


if __name__ == "__main__":
    main()
