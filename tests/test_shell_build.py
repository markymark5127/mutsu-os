"""Mutsu's GNOME Shell: core components first, login and unlock wait for
them, the session mode reaches every user; the look is built in."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / "packaging" / "shell"

# Minimal stand-ins for GNOME 51's files: the same anchors, plus just enough
# around them for the patched code to run under node.
LAYOUT = """import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from './main.js';
export class LayoutManager {
    async _prepareStartupAnimation() {
        if (Main.sessionMode.isGreeter) {
            this.panelBox.translation_y = -this.panelBox.height;
        } else {
            if (!Main.sessionMode.hasOverview) {
                this.uiGroup.opacity = 0;
            }
            await this._updateBackgrounds();
        }

        // Hack: Work around grab issue when testing greeter UI in nested
        this.emit('startup-prepared');
    }

    async _startupAnimationSession() {
        if (Main.sessionMode.hasOverview) {
            await Main.overview.runStartupAnimation();
        } else {
            await this.uiGroup.easeAsync({});
        }
    }
}
"""

EXTENSIONS = """const GLib = globalThis.__GLib;
const Main = globalThis.__Main;
const global = globalThis.__global;
const ExtensionState = {
    ACTIVE: 1, INACTIVE: 2, ERROR: 3, OUT_OF_DATE: 4, DOWNLOADING: 5,
    INITIALIZED: 6, DEACTIVATING: 7, ACTIVATING: 8,
};
const ENABLED_EXTENSIONS_KEY = 'enabled-extensions';
const DISABLE_USER_EXTENSIONS_KEY = 'disable-user-extensions';
const stateToString = s => String(s);
export {ExtensionState};
export class ExtensionManager {
    constructor() {
        this._handlers = [];
        this._extensions = new Map();
        this._extensionOrder = [];
        this._checkVersion = false;
    }

    connect(_signal, cb) {
        this._handlers.push(cb);
        return this._handlers.length;
    }

    disconnect(id) {
        this._handlers[id - 1] = null;
    }

    emit(_signal, ...args) {
        for (const handler of this._handlers)
            handler?.(this, ...args);
    }

    lookup(uuid) {
        return this._extensions.get(uuid);
    }

    _extensionSupportsSessionMode(_uuid) {
        return true;
    }

    _getModeExtensions() {
        if (Array.isArray(Main.sessionMode.enabledExtensions))
            return Main.sessionMode.enabledExtensions;
        return [];
    }

    _getEnabledExtensions() {
        let extensions = this._getModeExtensions();
        if (!global.settings.get_boolean(DISABLE_USER_EXTENSIONS_KEY))
            extensions = extensions.concat(global.settings.get_strv(ENABLED_EXTENSIONS_KEY));
        extensions.sort((a, b) => this._compareExtensions(this.lookup(a), this.lookup(b)));
        return extensions;
    }

    async _loadExtensions(extensionObjects) {
        for (const extension of extensionObjects) {
            // eslint-disable-next-line no-await-in-loop
            await this.loadExtension(extension);
        }
    }

    async loadExtension(extension) {
        const {uuid} = extension;
        this._extensions.set(uuid, extension);
        extension.state = extension.finalState ?? ExtensionState.ACTIVE;
        console.debug(`Extension ${uuid} in state ${stateToString(extension.state)} after loading`);
        this.emit('extension-state-changed', extension);
    }

    _compareExtensions(a, b) {
        const modesA = a?.sessionModes ?? [];
        const modesB = b?.sessionModes ?? [];
        return modesB.length - modesA.length;
    }
}
"""

SCREEN_SHIELD = """const Main = globalThis.__Main;
export class ScreenShield {
    constructor() {
        this.calls = [];
        this._dialog = {popModal: () => this.calls.push('popModal')};
        this._isGreeter = false;
    }

    _continueDeactivate(animate) {
        this.calls.push('hideLockScreen');
        if (this._dialog && !this._isGreeter)
            this._dialog.popModal();

        this.calls.push(animate ? 'slide' : 'cut');
    }
}
"""

# Runs the patched files with stand-ins for GLib, Main and GSettings and
# prints what happened, for the Python side to check.
DRIVER = r"""
import fs from 'node:fs';
import path from 'node:path';
const [dir, coreDir] = process.argv.slice(2);
const timers = new Map();
let next = 1;
globalThis.log = msg => logs.push(msg);
globalThis.logError = (e, msg) => logs.push(`${msg}: ${e}`);
console.debug = () => {};
const logs = [];
globalThis.__GLib = {
    PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
    get_monotonic_time: () => Math.round(performance.now() * 1000),
    get_system_data_dirs: () => ['/nonexistent', coreDir],
    build_filenamev: parts => path.join(...parts),
    file_get_contents: f => [true, fs.readFileSync(f)],
    timeout_add(_prio, ms, fn) {
        const id = next++;
        timers.set(id, setInterval(() => {
            if (!fn())
                this.source_remove(id);
        }, ms));
        return id;
    },
    source_remove(id) {
        clearInterval(timers.get(id));
        timers.delete(id);
    },
};
const settings = {'disable-user-extensions': false, 'enabled-extensions': []};
globalThis.__global = {settings: {
    get_boolean: k => settings[k],
    get_strv: k => [...settings[k]],
}};
const mode = {enabledExtensions: [], isLocked: false, isGreeter: false};
globalThis.__Main = {sessionMode: mode};
const {ExtensionManager, ExtensionState} = await import(path.join(dir, 'extensionSystem.mjs'));
const {ScreenShield} = await import(path.join(dir, 'screenShield.mjs'));
const out = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ext = (uuid, modes = ['user'], extra = {}) => ({uuid, sessionModes: modes, ...extra});
const settledWithin = async (promise, ms) => {
    let done = false;
    promise.then(() => (done = true));
    await sleep(ms);
    return done;
};

// Load order: GNOME's (lock screen capable first), then Mutsu's core order.
let m = new ExtensionManager();
out.core = m._mutsuCore;
const objs = [ext('zz'), ext('kiwi@kemma'), ext('dock'),
    ext('blur', ['user', 'unlock-dialog']), ext('adaptive', ['user', 'unlock-dialog'])];
out.order = objs.sort(m._compareExtensions.bind(m)).map(e => e.uuid);

// The session mode and the user's own list overlap: enabled once.
mode.enabledExtensions = ['dock', 'zz'];
settings['enabled-extensions'] = ['dock', 'gsconnect'];
out.enabled = m._getEnabledExtensions();
// Safe mode switches the session mode's extensions off too.
settings['disable-user-extensions'] = true;
out.safeMode = m._getEnabledExtensions();
settings['disable-user-extensions'] = false;

// Login: waits for the core (dock, kiwi), not for add-ons.
mode.enabledExtensions = ['dock', 'kiwi@kemma', 'zz'];
settings['enabled-extensions'] = [];
m = new ExtensionManager();
let wait = m.mutsuWaitForCore(5000);
await m.loadExtension(ext('dock'));
out.waitsForKiwi = !(await settledWithin(wait, 150));
await m.loadExtension(ext('kiwi@kemma'));
out.readyWithCore = await settledWithin(wait, 50);

// A core component that fails still lets the desktop show.
m = new ExtensionManager();
wait = m.mutsuWaitForCore(5000);
await m.loadExtension(ext('dock', ['user'], {finalState: ExtensionState.ERROR}));
await m.loadExtension(ext('kiwi@kemma'));
out.readyDespiteError = await settledWithin(wait, 50);

// Not installed: once loading is over, don't wait for it.
mode.enabledExtensions = ['dock', 'kiwi@kemma'];
m = new ExtensionManager();
wait = m.mutsuWaitForCore(5000);
await m._loadExtensions([ext('dock')]);
out.readyWithoutMissing = await settledWithin(wait, 250);

// A hung component: the limit shows the desktop anyway, and says so.
m = new ExtensionManager();
const t0 = performance.now();
await m.mutsuWaitForCore(300, 'test');
out.limitMs = Math.round(performance.now() - t0);
out.limitLog = logs.at(-1);

// Unlock: loaded but switched off while locked; waits until it's back on.
m = new ExtensionManager();
await m._loadExtensions([ext('dock'), ext('kiwi@kemma')]);
m.lookup('kiwi@kemma').state = ExtensionState.INACTIVE;
wait = m.mutsuWaitForCore(5000);
out.unlockWaits = !(await settledWithin(wait, 150));
m.lookup('kiwi@kemma').state = ExtensionState.ACTIVE;
m.emit('extension-state-changed', m.lookup('kiwi@kemma'));
out.unlockReady = await settledWithin(wait, 50);

// While locked nothing is wanted.
mode.isLocked = true;
out.lockedReady = await settledWithin(new ExtensionManager().mutsuWaitForCore(5000), 50);
mode.isLocked = false;

// The lock screen stays up (and keeps input) until the core is back.
let release;
globalThis.__Main.extensionManager = {
    mutsuWaitForCore: () => new Promise(r => (release = r)),
};
let shield = new ScreenShield();
shield._continueDeactivate(true);
out.unlockBefore = [...shield.calls];
release();
await sleep(10);
out.unlockAfter = shield.calls;
// Locked again during the wait: don't reveal anything.
shield = new ScreenShield();
shield._continueDeactivate(true);
mode.isLocked = true;
release();
await sleep(10);
out.relocked = shield.calls;
mode.isLocked = false;
// No extension manager (a plain Shell): unlock as GNOME does.
delete globalThis.__Main.extensionManager;
shield = new ScreenShield();
shield._continueDeactivate(false);
out.plain = shield.calls;

console.log(JSON.stringify(out));
process.exit(0);
"""


class ShellPatchTests(unittest.TestCase):
    def tree(self, tmp):
        ui = Path(tmp, "js/ui")
        ui.mkdir(parents=True)
        (ui / "layout.js").write_text(LAYOUT)
        (ui / "extensionSystem.js").write_text(EXTENSIONS)
        (ui / "screenShield.js").write_text(SCREEN_SHIELD)
        return ui

    def patch(self, tmp):
        return subprocess.run([sys.executable, str(SHELL / "apply-mutsu-shell.py"), tmp],
                              capture_output=True, text=True)

    def test_login_and_unlock_wait_for_core(self):
        with tempfile.TemporaryDirectory() as tmp:
            ui = self.tree(tmp)
            result = self.patch(tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            layout = (ui / "layout.js").read_text()
            wait = layout.index("await this._mutsuWaitForCore(8000)")
            self.assertLess(wait, layout.index("this.emit('startup-prepared')"))
            self.assertIn("!Main.sessionMode.isGreeter", layout)
            # Lands on the desktop, never the overview.
            self.assertIn("if (Main.sessionMode.hasOverview && !this._mutsuDesktopStart())", layout)
            self.assertIn("if (!Main.sessionMode.hasOverview || this._mutsuDesktopStart())", layout)
            # GNOME 51 has no Meta.is_restart(): calling it blacked out login.
            self.assertNotIn("is_restart", layout)
            self.assertIn("logError(e, 'Mutsu OS: waiting for core components')", layout)
            # Twice is the same as once.
            before = {f.name: f.read_text() for f in ui.iterdir()}
            self.patch(tmp)
            self.assertEqual({f.name: f.read_text() for f in ui.iterdir()}, before)

    @unittest.skipUnless(shutil.which("node"), "needs node")
    def test_patched_code_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            ui = self.tree(tmp)
            self.assertEqual(self.patch(tmp).returncode, 0)
            for name in ("layout.js", "extensionSystem.js", "screenShield.js"):
                mjs = Path(tmp, name.replace(".js", ".mjs"))
                mjs.write_text((ui / name).read_text())
                subprocess.run(["node", "--check", str(mjs)], check=True)
            core = Path(tmp, "data/mutsu-os")
            core.mkdir(parents=True)
            (core / "shell-core").write_text("# comment\nadaptive\ndock\n\nkiwi@kemma\n")
            driver = Path(tmp, "driver.mjs")
            driver.write_text(DRIVER)
            run = subprocess.run(["node", str(driver), tmp, str(Path(tmp, "data"))],
                                 capture_output=True, text=True, timeout=60)
            self.assertEqual(run.returncode, 0, run.stderr)
            out = json.loads(run.stdout)
        self.assertEqual(out["core"], ["adaptive", "dock", "kiwi@kemma"])
        self.assertEqual(out["order"], ["adaptive", "blur", "dock", "kiwi@kemma", "zz"])
        self.assertEqual(sorted(out["enabled"]), ["dock", "gsconnect", "zz"])
        self.assertEqual(out["safeMode"], [])
        self.assertTrue(out["waitsForKiwi"])
        self.assertTrue(out["readyWithCore"])
        self.assertTrue(out["readyDespiteError"])
        self.assertTrue(out["readyWithoutMissing"])
        self.assertGreaterEqual(out["limitMs"], 290)
        self.assertLess(out["limitMs"], 1500)
        self.assertIn("test shown after", out["limitLog"])
        self.assertIn("without dock, kiwi@kemma", out["limitLog"])
        self.assertTrue(out["unlockWaits"])
        self.assertTrue(out["unlockReady"])
        self.assertTrue(out["lockedReady"])
        self.assertEqual(out["unlockBefore"], ["hideLockScreen"])
        self.assertEqual(out["unlockAfter"], ["hideLockScreen", "popModal", "slide"])
        self.assertEqual(out["relocked"], ["hideLockScreen"])
        self.assertEqual(out["plain"], ["hideLockScreen", "popModal", "cut"])

    def test_moved_code_stops_the_build(self):
        for name in ("layout.js", "extensionSystem.js", "screenShield.js"):
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                ui = self.tree(tmp)
                (ui / name).write_text("export class Moved {}\n")
                result = self.patch(tmp)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("can't find", result.stderr)


@unittest.skipUnless(shutil.which("glib-compile-resources") and shutil.which("gresource"),
                     "needs glib-compile-resources and gresource")
class ThemeBakeTests(unittest.TestCase):
    def test_look_goes_into_light_and_dark_but_not_high_contrast(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp, "src")
            (src / "icons").mkdir(parents=True)
            for name in ("gnome-shell-light.css", "gnome-shell-dark.css", "gnome-shell-high-contrast.css"):
                (src / name).write_text(f"/* {name} */\n")
            (src / "icons" / "a.svg").write_text("<svg/>")
            xml = Path(tmp, "t.xml")
            xml.write_text('<gresources><gresource prefix="/org/gnome/shell/theme">'
                           "<file>gnome-shell-light.css</file><file>gnome-shell-dark.css</file>"
                           "<file>gnome-shell-high-contrast.css</file><file>icons/a.svg</file>"
                           "</gresource></gresources>")
            stock, out = Path(tmp, "in.gresource"), Path(tmp, "out.gresource")
            subprocess.run(["glib-compile-resources", f"--sourcedir={src}", f"--target={stock}", str(xml)], check=True)
            sage = str(ROOT / "extensions/mutsu-adaptive@mutsu-os/stylesheet.css") + "::/* ---- Mutsu sage accent"
            subprocess.run([sys.executable, str(SHELL / "bake-shell-theme.py"), str(stock), str(out),
                            str(ROOT / "branding/shell/japandi.css"), sage], check=True, capture_output=True)

            def css(name):
                return subprocess.run(["gresource", "extract", str(out), f"/org/gnome/shell/theme/{name}"],
                                      check=True, capture_output=True, text=True).stdout
            for name in ("gnome-shell-light.css", "gnome-shell-dark.css"):
                text = css(name)
                self.assertIn("Mutsu OS (built in)", text)
                self.assertIn("Shoji Glass", text, "Japandi")
                self.assertIn(".toggle-switch:checked { background: #61806A", text, "liquid sage accent")
                self.assertNotIn(".mutsu-gamepad", text, "only the sage block of the tablet stylesheet")
            self.assertNotIn("Mutsu", css("gnome-shell-high-contrast.css"))


class ImageTests(unittest.TestCase):
    def test_shell_reads_the_overlay(self):
        conf = (SHELL / "mutsu-shell-overlay.conf").read_text()
        self.assertIn("Environment=G_RESOURCE_OVERLAYS=/org/gnome/shell/ui=/usr/share/mutsu-os/shell-overlay/ui", conf)
        script = (SHELL / "make-shell-overlay.sh").read_text()
        for name in ("layout.js", "extensionSystem.js", "screenShield.js"):
            self.assertIn(name, script)

    def test_user_session_runs_in_mutsu_mode(self):
        conf = (SHELL / "mutsu-session-mode.conf").read_text()
        # Replaces GNOME's ExecStart (--mode=%i) for the user instance only.
        self.assertIn("ExecStart=\nExecStart=/usr/bin/gnome-shell --mode=mutsu", conf)
        image = (ROOT / "Containerfile").read_text()
        self.assertIn("org.gnome.Shell@user.service.d/mutsu-session-mode.conf", image)
        self.assertNotIn("org.gnome.Shell@.service.d/mutsu-session-mode.conf", image)
        # In place before the native desktop check reads it.
        self.assertLess(image.index("mutsu-session-mode.conf"),
                        image.index("python3 /tmp/mutsu-verify-native-desktop.py"))
        self.assertIn("gnome-shell --list-modes | grep -qx mutsu", image)


    def test_image_installs_the_shell_and_theme(self):
        text = (ROOT / "Containerfile").read_text()
        for needle in ("AS shell", "make-shell-overlay.sh /out/overlay",
                       "bake-shell-theme.py", "COPY --from=shell /out/",
                       "org.gnome.Shell@.service.d/mutsu-shell-overlay.conf",
                       "/usr/share/mutsu-os/shell-theme-built-in"):
            self.assertIn(needle, text)
        branding = (ROOT / "extensions/mutsu-branding@mutsu-os/extension.js").read_text()
        self.assertIn("/usr/share/mutsu-os/shell-theme-built-in", branding)

    def test_cyberpunk_covers_everything_japandi_styles(self):
        """Japandi is built in, so another look must restyle all of it."""
        import re

        def selectors(name):
            text = (ROOT / "branding/shell" / name).read_text()
            text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
            found = set()
            for head in re.findall(r"([^{}]+)\{", text):
                found |= {s.strip() for s in head.split(",") if s.strip()}
            return found
        self.assertEqual(selectors("japandi.css") - selectors("cyberpunk.css"), set())


if __name__ == "__main__":
    unittest.main()
