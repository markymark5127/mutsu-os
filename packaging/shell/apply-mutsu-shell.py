#!/usr/bin/env python3
"""Mutsu's changes to GNOME Shell: the desktop arrives finished.

Mutsu's dock, menu bar, window buttons and tablet mode are GNOME Shell
extensions, but they are the OS's own components, so they behave like it:

  * Every user gets them. Mutsu starts the Shell in its own session mode
    (/usr/share/gnome-shell/modes/mutsu.json, the same mechanism Ubuntu uses
    for its dock). GNOME always enables a session mode's extensions,
    whatever is in the user's own enabled-extensions list, and that list is
    frozen the first time anything toggles an extension. Turning one off in
    Extensions still works (GNOME records it in disabled-extensions), and
    so does safe mode: when extensions are switched off altogether
    (disable-user-extensions, which GNOME also sets itself after a crash
    early in the session), the session mode's extensions are off too, so a
    broken component can't keep crashing the Shell.
  * They come first. The core components listed in
    /usr/share/mutsu-os/shell-core (one UUID per line) are loaded and
    enabled before any other extension; add-ons follow.
  * The login animation waits for them (at most CORE_LOGIN_MS), so the
    session opens on the finished desktop instead of stock GNOME with the
    dock and menu bar arriving seconds later. ExtensionManager
    .mutsuWaitForCore() is the promise; failures and timeouts are logged
    and the Shell carries on.
  * Login lands on the desktop, not the overview, without relying on an
    extension to close the overview afterwards.
  * Unlocking waits for them too (at most CORE_UNLOCK_MS). GNOME turns off
    every extension without lock-screen support while the screen is locked
    and turns them back on as the lock screen slides away, so the dock used
    to be rebuilt and restyled in plain view.

    apply-mutsu-shell.py <dir with js/ui/{layout,extensionSystem,screenShield}.js>

make-shell-overlay.sh runs it on the files taken from the installed Shell;
the Shell reads the results through a resource overlay.

Edits by anchors and fails loudly if an anchor is missing, so a new GNOME
release that moved the code stops the build instead of shipping unpatched.
Running it twice changes nothing. None of it applies to the login screen
(greeter). (GNOME 51 has no Meta.is_restart(); calling it blacked out login.)
"""
import sys
from pathlib import Path

MARK = "Mutsu OS"
CORE_LOGIN_MS = 8000
CORE_UNLOCK_MS = 2000
CORE_FILE = "mutsu-os/shell-core"

def patch(path: Path, edits):
    text = path.read_text()
    if MARK in text:
        return
    for anchor, replacement, what in edits:
        if text.count(anchor) != 1:
            sys.exit(f"apply-mutsu-shell: can't find {what} in {path}")
        text = text.replace(anchor, replacement)
    path.write_text(text)


EXTENSION_SYSTEM = [
    (
        "        this._extensionOrder = [];\n"
        "        this._checkVersion = false;\n",
        "        this._extensionOrder = [];\n"
        "        this._checkVersion = false;\n"
        "\n"
        "        // Mutsu OS: the OS's own components (dock, menu bar, window\n"
        "        // buttons, tablet mode). Enabled before other extensions, and\n"
        "        // the desktop is shown once they are on.\n"
        "        this._mutsuCore = this._mutsuReadCore();\n"
        "        this._mutsuLoaded = false;\n"
        "        this._mutsuSettled = new Set(); // finished loading\n",
        "the ExtensionManager constructor",
    ),
    (
        "    _compareExtensions(a, b) {\n"
        "        const modesA = a?.sessionModes ?? [];\n"
        "        const modesB = b?.sessionModes ?? [];\n"
        "        return modesB.length - modesA.length;\n"
        "    }\n",
        "    _compareExtensions(a, b) {\n"
        "        const modesA = a?.sessionModes ?? [];\n"
        "        const modesB = b?.sessionModes ?? [];\n"
        "        // Mutsu OS: GNOME's order (lock screen capable first, so locking\n"
        "        // doesn't cycle them), then Mutsu's core in its own order.\n"
        "        const rank = e => {\n"
        "            const i = this._mutsuCore.indexOf(e?.uuid);\n"
        "            return i < 0 ? this._mutsuCore.length : i;\n"
        "        };\n"
        "        return (modesB.length - modesA.length) || (rank(a) - rank(b));\n"
        "    }\n"
        "\n"
        "    // Mutsu OS: UUIDs from <data dir>/" + CORE_FILE + ", one per line.\n"
        "    _mutsuReadCore() {\n"
        "        for (const dir of GLib.get_system_data_dirs()) {\n"
        "            try {\n"
        "                const [, bytes] = GLib.file_get_contents(\n"
        "                    GLib.build_filenamev([dir, '" + CORE_FILE + "']));\n"
        "                return new TextDecoder().decode(bytes).split('\\n')\n"
        "                    .map(l => l.trim()).filter(l => l && !l.startsWith('#'));\n"
        "            } catch {}\n"
        "        }\n"
        "        return [];\n"
        "    }\n"
        "\n"
        "    // Mutsu OS: the core components that should be on right now.\n"
        "    // Without a core list (a plain GNOME session), every enabled one.\n"
        "    _mutsuPendingCore() {\n"
        "        if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter)\n"
        "            return [];\n"
        "        const enabled = this._getEnabledExtensions();\n"
        "        const wanted = this._mutsuCore.length\n"
        "            ? enabled.filter(uuid => this._mutsuCore.includes(uuid))\n"
        "            : enabled;\n"
        "        const busy = [\n"
        "            ExtensionState.INACTIVE, ExtensionState.INITIALIZED,\n"
        "            ExtensionState.ACTIVATING, ExtensionState.DOWNLOADING,\n"
        "        ];\n"
        "        return wanted.filter(uuid => {\n"
        "            // Not loaded yet. Once loading is over: not installed.\n"
        "            if (!this._mutsuSettled.has(uuid))\n"
        "                return !this._mutsuLoaded;\n"
        "            if (!this._extensionSupportsSessionMode(uuid))\n"
        "                return false;\n"
        "            return busy.includes(this.lookup(uuid)?.state);\n"
        "        });\n"
        "    }\n"
        "\n"
        "    // Mutsu OS: resolves once the core components are on (or failed),\n"
        "    // or after limitMs. Never rejects. Logs what it waited for.\n"
        "    mutsuWaitForCore(limitMs, what = 'desktop') {\n"
        "        const start = GLib.get_monotonic_time();\n"
        "        return new Promise(resolve => {\n"
        "            let stateId = 0, timerId = 0;\n"
        "            const check = () => {\n"
        "                let pending;\n"
        "                try {\n"
        "                    pending = this._mutsuPendingCore();\n"
        "                } catch (e) {\n"
        "                    logError(e, 'Mutsu OS: checking core components');\n"
        "                    pending = [];\n"
        "                }\n"
        "                const ms = Math.round((GLib.get_monotonic_time() - start) / 1000);\n"
        "                if (pending.length && ms < limitMs)\n"
        "                    return false;\n"
        "                if (stateId)\n"
        "                    this.disconnect(stateId);\n"
        "                if (timerId)\n"
        "                    GLib.source_remove(timerId);\n"
        "                stateId = timerId = 0;\n"
        "                log(pending.length\n"
        "                    ? `Mutsu OS: ${what} shown after ${ms} ms without ${pending.join(', ')}`\n"
        "                    : `Mutsu OS: ${what} ready in ${ms} ms`);\n"
        "                resolve();\n"
        "                return true;\n"
        "            };\n"
        "            if (check())\n"
        "                return;\n"
        "            stateId = this.connect('extension-state-changed', () => {\n"
        "                check();\n"
        "            });\n"
        "            // Also catches the limit, and core components that turn out\n"
        "            // not to be installed once loading is over.\n"
        "            timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {\n"
        "                if (check())\n"
        "                    return GLib.SOURCE_REMOVE;\n"
        "                return GLib.SOURCE_CONTINUE;\n"
        "            });\n"
        "        });\n"
        "    }\n",
        "_compareExtensions()",
    ),
    (
        "        extensions.sort((a, b) => this._compareExtensions(this.lookup(a), this.lookup(b)));\n",
        "        // Mutsu OS: the session mode and the user's list may name the same\n"
        "        // extension; enable it once.\n"
        "        extensions = [...new Set(extensions)];\n"
        "        extensions.sort((a, b) => this._compareExtensions(this.lookup(a), this.lookup(b)));\n",
        "the sort in _getEnabledExtensions()",
    ),
    (
        "    _getModeExtensions() {\n",
        "    _getModeExtensions() {\n"
        "        // Mutsu OS: safe mode (extensions switched off, also what GNOME\n"
        "        // does after an early crash) includes the session mode's own.\n"
        "        if (global.settings.get_boolean(DISABLE_USER_EXTENSIONS_KEY))\n"
        "            return [];\n",
        "_getModeExtensions()",
    ),
    (
        "        console.debug(`Extension ${uuid} in state ${stateToString(extension.state)} after loading`);\n",
        "        this._mutsuSettled.add(uuid); // Mutsu OS\n"
        "        console.debug(`Extension ${uuid} in state ${stateToString(extension.state)} after loading`);\n",
        "the end of loadExtension()",
    ),
    (
        "        for (const extension of extensionObjects) {\n"
        "            // eslint-disable-next-line no-await-in-loop\n"
        "            await this.loadExtension(extension);\n"
        "        }\n",
        "        for (const extension of extensionObjects) {\n"
        "            // eslint-disable-next-line no-await-in-loop\n"
        "            await this.loadExtension(extension);\n"
        "        }\n"
        "        // Mutsu OS: any core component not found by now isn't installed.\n"
        "        this._mutsuLoaded = true;\n",
        "the loading loop in _loadExtensions()",
    ),
]

LAYOUT = [
    (
        "    async _prepareStartupAnimation() {",
        "    // Mutsu OS: wait (at most limitMs) for Mutsu's core components.\n"
        "    async _mutsuWaitForCore(limitMs) {\n"
        "        const start = GLib.get_monotonic_time();\n"
        "        const left = () => limitMs - (GLib.get_monotonic_time() - start) / 1000;\n"
        "        // The extension manager is created a little after this runs.\n"
        "        while (!Main.extensionManager?.mutsuWaitForCore && left() > 0) {\n"
        "            // eslint-disable-next-line no-await-in-loop\n"
        "            await new Promise(resolve => {\n"
        "                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {\n"
        "                    resolve();\n"
        "                    return GLib.SOURCE_REMOVE;\n"
        "                });\n"
        "            });\n"
        "        }\n"
        "        if (left() > 0)\n"
        "            await Main.extensionManager?.mutsuWaitForCore(left(), 'desktop');\n"
        "    }\n"
        "\n"
        "    // Mutsu OS: a session opens on the desktop, like a Mac, never on the\n"
        "    // overview (GNOME's own fade-and-zoom for sessions without one).\n"
        "    _mutsuDesktopStart() {\n"
        "        return !Main.sessionMode.isGreeter;\n"
        "    }\n"
        "\n"
        "    async _prepareStartupAnimation() {",
        "_prepareStartupAnimation()",
    ),
    (
        "            if (!Main.sessionMode.hasOverview) {\n",
        "            if (!Main.sessionMode.hasOverview || this._mutsuDesktopStart()) {\n",
        "the no-overview startup setup",
    ),
    (
        "        // Hack: Work around grab issue when testing greeter UI in nested",
        "        // Mutsu OS: open on the finished desktop, not on stock GNOME\n"
        "        // with Mutsu's components arriving seconds later. Never on the\n"
        "        // login screen, and nothing here may stop the Shell starting.\n"
        "        if (!Main.sessionMode.isGreeter) {\n"
        "            try {\n"
        f"                await this._mutsuWaitForCore({CORE_LOGIN_MS});\n"
        "            } catch (e) {\n"
        "                logError(e, 'Mutsu OS: waiting for core components');\n"
        "            }\n"
        "        }\n"
        "\n"
        "        // Hack: Work around grab issue when testing greeter UI in nested",
        "the greeter grab hack before startup-prepared",
    ),
    (
        "        if (Main.sessionMode.hasOverview) {\n"
        "            await Main.overview.runStartupAnimation();\n",
        "        if (Main.sessionMode.hasOverview && !this._mutsuDesktopStart()) {\n"
        "            await Main.overview.runStartupAnimation();\n",
        "the overview startup animation",
    ),
]

SCREEN_SHIELD = [
    (
        "        if (this._dialog && !this._isGreeter)\n"
        "            this._dialog.popModal();\n",
        "        // Mutsu OS: the session mode is back to the desktop and the\n"
        "        // extensions it locked away are being turned back on. Keep the lock\n"
        "        // screen up (and input on it) until Mutsu's core components are\n"
        "        // there, so the dock and menu bar aren't rebuilt in plain view.\n"
        "        const waitId = this._mutsuUnlockId = (this._mutsuUnlockId ?? 0) + 1;\n"
        "        const wait = Main.extensionManager?.mutsuWaitForCore?.(\n"
        f"            {CORE_UNLOCK_MS}, 'unlocked desktop');\n"
        "        if (!wait) {\n"
        "            this._mutsuFinishDeactivate(animate);\n"
        "            return;\n"
        "        }\n"
        "        wait.then(() => {\n"
        "            // Locked again meanwhile, or a newer unlock took over.\n"
        "            if (waitId !== this._mutsuUnlockId || Main.sessionMode.isLocked)\n"
        "                return;\n"
        "            this._mutsuFinishDeactivate(animate);\n"
        "        });\n"
        "    }\n"
        "\n"
        "    _mutsuFinishDeactivate(animate) {\n"
        "        if (this._dialog && !this._isGreeter)\n"
        "            this._dialog.popModal();\n",
        "the popModal in _continueDeactivate()",
    ),
]


def main(src: str) -> None:
    ui = Path(src) / "js/ui"
    patch(ui / "extensionSystem.js", EXTENSION_SYSTEM)
    patch(ui / "layout.js", LAYOUT)
    patch(ui / "screenShield.js", SCREEN_SHIELD)
    print("apply-mutsu-shell: core components first; login and unlock wait for them")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
