#!/usr/bin/env python3
"""Remove superseded Mutsu disk artifacts after 24 hours, keeping the newest.

The newest artifact of *each* disk type and architecture is always protected.
This is separate from GitHub's built-in artifact expiration policy; GitHub can
still expire the last artifact after the repository's retention limit.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

DISK_ARTIFACT = re.compile(r"^mutsu-os-(?:qcow2|anaconda-iso)-(?:amd64|arm64)$")
MIN_AGE = timedelta(hours=24)
API = "https://api.github.com"


def timestamp(raw: str) -> datetime:
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Artifact timestamp lacks a timezone")
    return value


def plan_deletions(artifacts: list[dict], now: datetime) -> tuple[list[dict], list[dict]]:
    """Return (latest_protected, old_superseded); never delete a newest artifact."""
    if now.tzinfo is None:
        raise ValueError("Current timestamp must include a timezone")
    valid = []
    for artifact in artifacts:
        if artifact.get("expired", False):
            continue
        if not DISK_ARTIFACT.fullmatch(artifact.get("name", "")):
            continue
        # Refuse to delete anything if relevant metadata is malformed.
        valid.append((artifact, timestamp(artifact["created_at"]), int(artifact["id"])))

    newest: dict[str, tuple[dict, datetime, int]] = {}
    for entry in valid:
        artifact, created, artifact_id = entry
        name = artifact["name"]
        if name not in newest or (created, artifact_id) > (newest[name][1], newest[name][2]):
            newest[name] = entry

    keep = sorted((entry[0] for entry in newest.values()), key=lambda a: a["name"])
    delete = sorted(
        (
            artifact for artifact, created, artifact_id in valid
            if artifact_id != newest[artifact["name"]][2]
            and now - created >= MIN_AGE
        ),
        key=lambda a: (a["name"], a["created_at"], a["id"]),
    )
    return keep, delete


def github_request(url: str, token: str, method: str = "GET") -> dict | None:
    request = Request(
        url,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "mutsu-disk-artifact-pruner",
        },
    )
    with urlopen(request, timeout=45) as response:
        if method == "DELETE":
            if response.status != 204:
                raise RuntimeError(f"Unexpected artifact deletion status {response.status}")
            return None
        return json.load(response)


def list_all_artifacts(repository: str, token: str) -> list[dict]:
    artifacts = []
    owner, name = repository.split("/", 1)
    path = f"{quote(owner, safe='')}/{quote(name, safe='')}"
    for page in range(1, 1001):
        data = github_request(
            f"{API}/repos/{path}/actions/artifacts?per_page=100&page={page}", token
        )
        page_artifacts = data["artifacts"]
        artifacts.extend(page_artifacts)
        if len(page_artifacts) < 100:
            return artifacts
    raise RuntimeError("Artifact pagination exceeded 1000 pages; refusing incomplete cleanup")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print deletions without deleting")
    args = parser.parse_args()

    repository = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) or not token:
        parser.error("GITHUB_REPOSITORY and GITHUB_TOKEN are required")

    artifacts = list_all_artifacts(repository, token)
    protected, old = plan_deletions(artifacts, datetime.now(timezone.utc))

    print(f"Protected newest builds: {len(protected)}")
    for a in protected:
        print(f"  KEEP: {a['name']} (artifact {a['id']})")
    print(f"Superseded builds older than 24 hours: {len(old)}")

    removed = 0
    for a in old:
        if args.dry_run:
            print(f"  WOULD DELETE: {a['name']} (artifact {a['id']})")
        else:
            github_request(
                f"{API}/repos/{repository}/actions/artifacts/{a['id']}", token, "DELETE"
            )
            removed += 1
            print(f"  DELETED: {a['name']} (artifact {a['id']})")

    message = (
        f"Protected newest: {len(protected)}; "
        f"{'would delete' if args.dry_run else 'deleted'}: "
        f"{len(old) if args.dry_run else removed}."
    )
    print(message)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"### Mutsu disk-image cleanup\n\n{message}\n\n")
            output.write(
                "The newest artifact of each type/architecture is protected from this "
                "cleanup, but is still subject to GitHub's repository artifact "
                "retention limit.\n"
            )


if __name__ == "__main__":
    main()
