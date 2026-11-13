"""Weekly Beta release: build -> exact-image GNOME check -> move `beta`."""

import re
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:  # the CI runner's python may not have PyYAML
    yaml = None

ROOT = Path(__file__).resolve().parents[1]
WF = ROOT / ".github/workflows"


def load(name):
    data = yaml.safe_load((WF / name).read_text())
    # PyYAML reads the bare key `on` as True
    data["on"] = data.pop(True, data.get("on"))
    return data


@unittest.skipUnless(yaml, "needs PyYAML")
class BetaReleaseTests(unittest.TestCase):
    def setUp(self):
        self.wf = load("beta-release.yml")
        self.text = (WF / "beta-release.yml").read_text()

    def test_runs_every_friday_and_by_hand(self):
        cron = self.wf["on"]["schedule"][0]["cron"].split()
        self.assertEqual(cron[4], "5")            # Friday
        self.assertIn("workflow_dispatch", self.wf["on"])
        self.assertFalse(self.wf["concurrency"]["cancel-in-progress"])

    def test_publishes_only_after_the_exact_image_passes(self):
        jobs = self.wf["jobs"]
        self.assertEqual(jobs["build"]["uses"], "./.github/workflows/build.yml")
        self.assertEqual(jobs["runtime"]["uses"], "./.github/workflows/gnome-runtime.yml")
        self.assertEqual(jobs["runtime"]["with"]["image_tag"], "${{ needs.image.outputs.tag }}")
        self.assertEqual(set(jobs["publish"]["needs"]), {"image", "runtime"})
        self.assertIn('tag="latest-${GITHUB_SHA:0:7}"', self.text)
        # beta moves to the digest that was tested, not to whatever latest is now
        self.assertIn('"docker://${REPO}@${DIGEST}" "docker://${REPO}:${tag}"', self.text)
        self.assertIn("--preserve-digests", self.text)
        self.assertIn("--prerelease", self.text)

    def test_called_workflows_accept_the_call(self):
        self.assertIn("workflow_call", load("build.yml")["on"])
        runtime = load("gnome-runtime.yml")["on"]["workflow_call"]["inputs"]["image_tag"]
        self.assertEqual(runtime["type"], "string")
        self.assertIn("inputs.image_tag", (WF / "gnome-runtime.yml").read_text())



class BetaTextTests(unittest.TestCase):
    """The same promises, checked without PyYAML."""

    def test_friday_build_check_then_publish(self):
        text = (WF / "beta-release.yml").read_text()
        self.assertIn("cron: '17 14 * * 5'", text)
        self.assertIn("needs: [image, runtime]", text)
        self.assertIn('"docker://${REPO}@${DIGEST}" "docker://${REPO}:${tag}"', text)

    def test_version_file(self):
        self.assertRegex((ROOT / "packaging/release-version").read_text().strip(), r"^\d+\.\d+\.\d+$")

    def test_installs_follow_beta(self):
        customize = (ROOT / "packaging/live/customize.sh").read_text()
        self.assertIn("IMAGE_REF=${MUTSU_IMAGE_REF:-ghcr.io/markymark5127/mutsu-os:beta}", customize)
        self.assertIn('--arg ref "${SOURCE_TAG%:*}:beta"', (WF / "build-live-iso.yml").read_text())


if __name__ == "__main__":
    unittest.main()
