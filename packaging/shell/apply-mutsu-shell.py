#!/usr/bin/env python3
"""Mutsu's change to GNOME Shell: log in to the finished desktop.

GNOME starts its login animation before extensions are enabled, so Mutsu's
dock, look and tablet mode visibly arrive a moment after the desktop shows.
This makes the animation wait for the extensions (at most 3 seconds, so a
slow or broken extension can't hold up the login):

  * extensionSystem.js keeps the promise of the first enable pass
    (ExtensionManager.startupComplete);
  * layout.js waits for it before the startup animation, except on the
    login screen (greeter). Any failure in the wait is logged and ignored:
    the Shell must always start. (GNOME 51 has no Meta.is_restart(); calling
    it threw before the login screen and left a black screen.)

    apply-mutsu-shell.py <dir with js/ui/layout.js and js/ui/extensionSystem.js>

make-shell-overlay.sh runs it on the files taken from the installed Shell.

Edits by anchors and fails loudly if an anchor is missing, so a new GNOME
release that moved the code stops the build instead of shipping unpatched.
Running it twice changes nothing.
"""
import sys
from pathlib import Path

MARK = "Mutsu OS"
WAIT_MS = 3000


def patch(path: Path, edits):
    text = path.read_text()
    if MARK in text:
        return
    for anchor, replacement, what in edits:
        if text.count(anchor) != 1:
            sys.exit(f"apply-mutsu-shell: can't find {what} in {path}")
        text = text.replace(anchor, replacement)
    path.write_text(text)


def main(src: str) -> None:
    root = Path(src)
    patch(root / "js/ui/extensionSystem.js", [(
        "        this._sessionUpdated().then(() => {",
        "        // Mutsu OS: the login animation waits for this first pass.\n"
        "        this.startupComplete = this._sessionUpdated();\n"
        "        this.startupComplete.then(() => {",
        "the first _sessionUpdated() in init()",
    )])
    patch(root / "js/ui/layout.js", [
        (
            "    async _prepareStartupAnimation() {",
            "    // Mutsu OS: wait (at most limitMs) for extensions to be enabled.\n"
            "    async _mutsuWaitForExtensions(limitMs) {\n"
            "        const start = GLib.get_monotonic_time();\n"
            "        const left = () => limitMs - (GLib.get_monotonic_time() - start) / 1000;\n"
            "        const sleep = ms => new Promise(resolve => {\n"
            "            GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(ms)), () => {\n"
            "                resolve();\n"
            "                return GLib.SOURCE_REMOVE;\n"
            "            });\n"
            "        });\n"
            "        while (!Main.extensionManager?.startupComplete && left() > 0)\n"
            "            // eslint-disable-next-line no-await-in-loop\n"
            "            await sleep(50);\n"
            "        const done = Main.extensionManager?.startupComplete;\n"
            "        if (done && left() > 0)\n"
            "            await Promise.race([done.catch(() => {}), sleep(left())]);\n"
            "    }\n"
            "\n"
            "    async _prepareStartupAnimation() {",
            "_prepareStartupAnimation()",
        ),
        (
            "        // Hack: Work around grab issue when testing greeter UI in nested",
            "        // Mutsu OS: open on the finished desktop, not on stock GNOME\n"
            "        // with Mutsu's extensions arriving a moment later. Never on the\n"
            "        // login screen, and nothing here may stop the Shell starting.\n"
            "        if (!Main.sessionMode.isGreeter) {\n"
            "            try {\n"
            f"                await this._mutsuWaitForExtensions({WAIT_MS});\n"
            "            } catch (e) {\n"
            "                logError(e, 'Mutsu OS: waiting for extensions');\n"
            "            }\n"
            "        }\n"
            "\n"
            "        // Hack: Work around grab issue when testing greeter UI in nested",
            "the greeter grab hack before startup-prepared",
        ),
    ])
    print("apply-mutsu-shell: login waits for extensions")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
