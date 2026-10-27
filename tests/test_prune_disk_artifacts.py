"""Safety tests for the Mutsu ISO/QCOW2 artifact retention policy."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prune_disk_artifacts import plan_deletions


NOW = datetime(2026, 10, 27, 18, 0, tzinfo=timezone.utc)


def artifact(id: int, name: str, age_hours: float, expired: bool = False) -> dict:
    when = NOW - timedelta(hours=age_hours)
    return {
        "id": id,
        "name": name,
        "created_at": when.isoformat().replace("+00:00", "Z"),
        "expired": expired,
    }


class PruneDiskArtifactsTest(unittest.TestCase):
    def test_newest_iso_is_never_deleted_even_if_more_than_90_days_old(self):
        items = [
            artifact(1, "mutsu-os-anaconda-iso-amd64", 2500),
            artifact(2, "mutsu-os-anaconda-iso-amd64", 2200),
        ]
        keep, delete = plan_deletions(items, NOW)
        self.assertEqual([a["id"] for a in keep], [2])
        self.assertEqual([a["id"] for a in delete], [1])

    def test_keep_newest_per_disk_type_and_architecture(self):
        items = [
            artifact(11, "mutsu-os-qcow2-amd64", 50),
            artifact(12, "mutsu-os-qcow2-amd64", 40),
            artifact(21, "mutsu-os-anaconda-iso-amd64", 35),
            artifact(22, "mutsu-os-anaconda-iso-amd64", 34),
            artifact(31, "mutsu-os-qcow2-arm64", 100),
            artifact(32, "mutsu-os-qcow2-arm64", 90),
        ]
        keep, delete = plan_deletions(items, NOW)
        self.assertEqual({a["id"] for a in keep}, {12, 22, 32})
        self.assertEqual({a["id"] for a in delete}, {11, 21, 31})

    def test_recent_obsolete_build_is_not_deleted_until_a_day_old(self):
        items = [
            artifact(1, "mutsu-os-qcow2-amd64", 23.99),
            artifact(2, "mutsu-os-qcow2-amd64", 2),
        ]
        _, delete = plan_deletions(items, NOW)
        self.assertEqual(delete, [])
        items[0] = artifact(1, "mutsu-os-qcow2-amd64", 24)
        _, delete = plan_deletions(items, NOW)
        self.assertEqual([a["id"] for a in delete], [1])

    def test_unrelated_artifacts_and_expired_artifacts_are_ignored(self):
        items = [
            artifact(1, "mutsu-os-qcow2-amd64", 100),
            artifact(2, "mutsu-os-qcow2-amd64", 90),
            artifact(3, "mutsu-os-qcow2-amd64", 80, expired=True),
            artifact(4, "test-results", 100),
            artifact(5, "mutsu-os-anaconda-iso-arm64-extra", 100),
        ]
        keep, delete = plan_deletions(items, NOW)
        self.assertEqual([a["id"] for a in keep], [2])
        self.assertEqual([a["id"] for a in delete], [1])

    def test_newest_is_selected_by_time_not_listing_order(self):
        items = [
            artifact(99, "mutsu-os-qcow2-amd64", 30),
            artifact(1, "mutsu-os-qcow2-amd64", 1),
            artifact(55, "mutsu-os-qcow2-amd64", 60),
        ]
        keep, delete = plan_deletions(items, NOW)
        self.assertEqual([a["id"] for a in keep], [1])
        self.assertEqual([a["id"] for a in delete], [55, 99])

    def test_malformed_disk_metadata_aborts_instead_of_deleting(self):
        with self.assertRaises((ValueError, KeyError)):
            plan_deletions([
                artifact(1, "mutsu-os-qcow2-amd64", 100),
                {"id": 2, "name": "mutsu-os-qcow2-amd64", "created_at": "bad"},
            ], NOW)


if __name__ == "__main__":
    unittest.main()
