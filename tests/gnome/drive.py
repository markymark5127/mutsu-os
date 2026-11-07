#!/usr/bin/python3
"""Drive a headless GNOME Shell through Mutsu tablet mode and report.

Talks to the Shell over org.gnome.Shell.Eval (the Shell runs with
--unsafe-mode), synthesizes real touch events with a Clutter virtual
touchscreen, and finally scans the Shell log for errors from any bundled
extension. Writes report.md (and the GitHub step summary when available).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

OUT = sys.argv[-1]
ANALYZE_ONLY = "--analyze-only" in sys.argv
ADAPTIVE = "mutsu-adaptive@mutsu-os"
results = []  # (section, name, ok, detail)


def record(section, name, ok, detail=""):
    results.append((section, name, bool(ok), str(detail)))
    print(f"[{'PASS' if ok else 'FAIL'}] {section}: {name} {detail}", flush=True)


try:
    from gi.repository import Gio, GLib

    _proxy = None

    def _eval_raw(code):
        global _proxy
        if _proxy is None:
            bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
            _proxy = Gio.DBusProxy.new_sync(bus, Gio.DBusProxyFlags.NONE, None,
                                            "org.gnome.Shell", "/org/gnome/Shell",
                                            "org.gnome.Shell", None)
        ok, value = _proxy.call_sync("Eval", GLib.Variant("(s)", (code,)),
                                     Gio.DBusCallFlags.NONE, 20000, None).unpack()
        return ok, value
except ImportError:  # pragma: no cover - fallback for images without PyGObject
    def _eval_raw(code):
        out = subprocess.run(["gdbus", "call", "--session", "--dest", "org.gnome.Shell",
                              "--object-path", "/org/gnome/Shell",
                              "--method", "org.gnome.Shell.Eval", code],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        m = re.match(r"^\((true|false), '(.*)'\)$", out, re.S)
        if not m:
            return False, out
        return m.group(1) == "true", m.group(2).encode().decode("unicode_escape")


def js(code):
    """Evaluate an expression in the Shell; returns the decoded JSON value.

    Exceptions inside the Shell come back as {"error": ...}."""
    wrapped = f"""(() => {{ try {{ return ({code}); }} catch (e) {{
        return {{error: `${{e}}`, stack: `${{e.stack ?? ''}}`}}; }} }})()"""
    ok, value = _eval_raw(wrapped)
    if not ok:
        return {"error": f"Eval failed: {value}"}
    try:
        return json.loads(value) if value else None
    except json.JSONDecodeError:
        return {"error": f"bad JSON: {value[:200]}"}


def wait(seconds):
    time.sleep(seconds)


HELPERS = r"""
globalThis.__mutsuTest ??= (() => {
    const Clutter = imports.gi.Clutter, GLib = imports.gi.GLib;
    const seat = global.stage.get_context().get_backend().get_default_seat();
    const touch = seat.create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE);
    const now = () => GLib.get_monotonic_time();
    const later = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { fn(); return GLib.SOURCE_REMOVE; });
    const t = {
        log: [],
        tap(x, y, ms = 60) { touch.notify_touch_down(now(), 0, x, y); later(ms, () => touch.notify_touch_up(now(), 0)); },
        hold(x, y, ms = 900) { t.tap(x, y, ms); },
        holdDrag(x, y, dx, dy, ms = 800) {
            touch.notify_touch_down(now(), 0, x, y);
            for (let i = 1; i <= 8; i++)
                later(ms + i * 30, () => touch.notify_touch_motion(now(), 0, x + dx * i / 8, y + dy * i / 8));
            later(ms + 400, () => touch.notify_touch_up(now(), 0));
        },
        swipe(x0, y0, x1, y1, ms = 300, pause = 0) {
            touch.notify_touch_down(now(), 0, x0, y0);
            const steps = 12;
            for (let i = 1; i <= steps; i++)
                later(Math.round(ms * i / steps), () => touch.notify_touch_motion(now(), 0,
                    x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps));
            later(ms + pause + 20, () => touch.notify_touch_up(now(), 0));
        },
        center(actor) {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return [Math.round(x + w / 2), Math.round(y + h / 2)];
        },
        find(root, pred) {
            const stack = root ? [root] : [];
            while (stack.length) {
                const a = stack.pop();
                if (pred(a))
                    return a;
                stack.push(...a.get_children());
            }
            return null;
        },
        ext() { return Main.extensionManager.lookup('mutsu-adaptive@mutsu-os')?.stateObj ?? null; },
    };
    return t;
})()
"""


def extension_states():
    states = js("""Object.fromEntries([...Main.extensionManager._extensions.values()].map(x =>
        [x.uuid, {state: x.state, error: `${x.error ?? ''}`, path: x.path ?? x.dir?.get_path?.()}]))""")
    if not isinstance(states, dict) or "error" in states and isinstance(states.get("error"), str):
        record("Extensions", "list extensions", False, states)
        return
    expected = sorted(os.listdir(os.path.join(os.environ["XDG_DATA_HOME"], "gnome-shell", "extensions")))
    for uuid in expected:
        info = states.get(uuid)
        if info is None:
            record("Extensions", uuid, False, "not loaded by the Shell")
            continue
        # ExtensionState.ACTIVE is 1 (ENABLED in older Shells).
        ok = info["state"] == 1 and not info["error"]
        detail = f"state={info['state']}" + (f" error={info['error']}" if info["error"] else "")
        if info.get("path") and "/.local/" not in info["path"]:
            ok = False
            detail += f" (loaded the image copy at {info['path']}, not this commit)"
        record("Extensions", uuid, ok, detail)


def tablet_flow():
    S = "Tablet mode"
    if js(f"Main.extensionManager.lookup('{ADAPTIVE}')?.state") != 1:
        record(S, "Mutsu Adaptive is active", False, "skipping tablet checks")
        return
    ok, value = _eval_raw(HELPERS.strip() + ";\ntypeof globalThis.__mutsuTest")
    record(S, "virtual touchscreen", ok and "object" in value, value)
    T = "globalThis.__mutsuTest"

    js(f"{T}.ext()._settings.set_string('mode', 'always-tablet')")
    wait(3)
    state = js(f"""(() => {{ const e = {T}.ext(); const h = e._home;
        return {{inTablet: e._inTablet, home: !!h, switcher: !!e._switcher, session: !!e._session,
            homeVisible: !!h?._root?.visible && !!h?._root?.mapped,
            keyboard: !!Main.keyboard.visible, keyFocus: `${{global.stage.key_focus}}`,
            tiles: h?._tiles?.size ?? 0}}; }})()""")
    record(S, "enters tablet mode", state.get("inTablet"), state)
    record(S, "Home is built and on screen", state.get("home") and state.get("homeVisible") and state.get("tiles", 0) > 0, state)
    record(S, "gestures/multitasking started", state.get("switcher"), state)
    record(S, "touch session started", state.get("session"), state)
    record(S, "on-screen keyboard stays closed on Home", state.get("keyboard") is False, state)
    if not state.get("home"):
        return

    # Tap an app icon: it must activate, not start jiggle mode.
    tap = js(f"""(() => {{ const t = {T}, h = t.ext()._home;
        const entry = [...h._tiles.values()].find(v => v.page === h._page && v.tile._mutsuTap);
        if (!entry) return {{error: 'no tappable tile on the current page'}};
        globalThis.__mutsuTapped = 0;
        entry.tile._mutsuTap = () => globalThis.__mutsuTapped++;
        const [x, y] = t.center(entry.tile); t.tap(x, y); return {{x, y}}; }})()""")
    wait(1.5)
    after = js(f"""({{tapped: globalThis.__mutsuTapped, editing: {T}.ext()._home.editing,
        stuck: {T}.ext()._home._router.active}})""")
    record(S, "tap on an icon opens it", after.get("tapped") == 1, {**tap, **after} if isinstance(tap, dict) else after)
    record(S, "tap does not start jiggle mode", after.get("editing") is False, after)
    record(S, "touch router is free after a tap", after.get("stuck") is False, after)

    # Hold an icon: its menu opens. Hold and drag: jiggle mode. Then tap Done.
    js(f"""(() => {{ const t = {T}, h = t.ext()._home;
        const entry = [...h._tiles.values()].find(v => v.page === h._page && v.tile._mutsuLongPress);
        const [x, y] = t.center(entry.tile); t.hold(x, y); return true; }})()""")
    wait(2)
    menu = js(f"{T}.ext()._home._menu.isOpen")
    record(S, "hold on an icon opens its menu", menu is True, menu)
    js(f"{T}.ext()._home._menu.close()")
    wait(1)
    js(f"""(() => {{ const t = {T}, h = t.ext()._home;
        const entry = [...h._tiles.values()].find(v => v.page === h._page && v.tile._mutsuLongPress);
        const [x, y] = t.center(entry.tile); t.holdDrag(x, y, 40, 0); return true; }})()""")
    wait(2.5)
    record(S, "hold and drag starts jiggle mode", js(f"{T}.ext()._home.editing") is True)
    done = js(f"""(() => {{ const t = {T}, h = t.ext()._home;
        const done = t.find(h._root, a => a.accessible_name === 'Done editing Home Screen');
        if (!done) return {{error: 'no Done button'}};
        const [x, y] = t.center(done); t.tap(x, y); return {{x, y}}; }})()""")
    wait(1.5)
    record(S, "Done leaves jiggle mode", isinstance(done, dict) and "error" not in done
           and js(f"{T}.ext()._home.editing") is False, done)
    record(S, "touch still works after jiggle mode", js(f"{T}.ext()._home._router.active") is False)

    # Dock popup and pull-down search entry points.
    dock = js(f"(() => {{ const s = {T}.ext()._switcher; s._dock.show(); const v = s._dock._box.visible; s._dock.hide(); return v; }})()")
    record(S, "swipe-up dock opens", dock is True, dock)

    # Leave tablet mode.
    js(f"{T}.ext()._settings.set_string('mode', 'always-desktop')")
    wait(3)
    left = js(f"({{inTablet: {T}.ext()._inTablet, home: !!{T}.ext()._home, saved: {T}.ext()._settings.get_string('saved-state')}})")
    record(S, "leaves tablet mode cleanly", left.get("inTablet") is False and not left.get("home") and left.get("saved") in ("", "{}"), left)
    # Automatic follows Mutter's touch mode (the virtual touchscreen counts).
    js(f"{T}.ext()._settings.set_string('mode', 'automatic')")
    wait(3)
    auto = js(f"""(() => {{ const seat = global.stage.get_context().get_backend().get_default_seat();
        return {{touchMode: seat.touch_mode, inTablet: {T}.ext()._inTablet,
            posture: {T}.ext()._posture?.description}}; }})()""")
    record(S, "Automatic follows the hinge / touch mode", auto.get("inTablet") == auto.get("touchMode"), auto)
    # From here on use forced modes: the virtual touchscreen keeps touch mode on.
    js(f"{T}.ext()._settings.set_string('mode', 'always-desktop')")


def window_flow():
    S = "Apps when folding"
    if not shutil.which("gjs"):
        record(S, "test app available", False, "no gjs in the image")
        return
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-window.js")
    procs = [subprocess.Popen(["gjs", "-m", script, name], stdout=subprocess.DEVNULL,
                              stderr=open(os.path.join(OUT, f"test-window-{name}.log"), "w"))
             for name in ("Alpha", "Beta")]
    try:
        for _ in range(30):
            wait(1)
            n = js("global.display.get_tab_list(imports.gi.Meta.TabList.NORMAL_ALL, null).length")
            if isinstance(n, int) and n >= 2:
                break
        record(S, "two test windows open", isinstance(n, int) and n >= 2, n)
        if not (isinstance(n, int) and n >= 2):
            return
        T = "globalThis.__mutsuTest"
        js(f"""(() => {{ const w = global.display.get_tab_list(imports.gi.Meta.TabList.NORMAL_ALL, null);
            w.forEach(x => x.unminimize()); Main.activateWindow(w[1]); globalThis.__mutsuFocus = w[1];
            globalThis.__mutsuOther = w[0]; return true; }})()""")
        wait(1)
        js(f"""(() => {{ const e = {T}.ext(); const orig = e._arrangeForTablet.bind(e);
            e._arrangeForTablet = () => {{
                globalThis.__mutsuArrange = {{visible: e._visibleWindows().map(w => w.get_title()),
                    focus: global.display.focus_window?.get_title() ?? null,
                    goHome: e._settings.get_boolean('open-home-on-tablet')}};
                try {{ orig(); }} catch (err) {{ globalThis.__mutsuArrange.error = `${{err}}`; throw err; }}
            }}; return true; }})()""")
        js(f"{T}.ext()._settings.set_string('mode', 'always-tablet')")
        wait(3)
        st0 = js(f"""(() => {{ const e = {T}.ext();
            return {{visible: e._visibleWindows().map(w => w.get_title()),
                focus: global.display.focus_window?.get_title() ?? null}}; }})()""")
        st = js(f"""(() => {{ const f = globalThis.__mutsuFocus, o = globalThis.__mutsuOther;
            return {{focusMin: f.minimized, focusMax: f.is_maximized?.() ?? !!f.get_maximized?.(),
                otherMin: o.minimized}}; }})()""")
        info = js("""global.display.get_tab_list(imports.gi.Meta.TabList.NORMAL_ALL, null).map(w =>
            ({title: w.get_title(), type: w.get_window_type(), resizable: w.allows_resize(),
              skip: w.is_skip_taskbar(), transient: !!w.get_transient_for(), min: w.minimized}))""")
        st["windows"] = info
        st["afterFold"] = st0
        st["arrange"] = js("globalThis.__mutsuArrange ?? null")
        record(S, "app in use stays open full screen", st.get("focusMin") is False and st.get("focusMax") is True, st)
        record(S, "other apps wait in multitasking", st.get("otherMin") is True, st)
        split = js(f"""(() => {{ const s = {T}.ext()._switcher.split;
            return s.arrange(globalThis.__mutsuOther, globalThis.__mutsuFocus); }})()""")
        wait(1.5)
        sp = js("""({a: globalThis.__mutsuOther.minimized, b: globalThis.__mutsuFocus.minimized,
            ax: globalThis.__mutsuOther.get_frame_rect().x, bx: globalThis.__mutsuFocus.get_frame_rect().x})""")
        record(S, "Split View shows both apps side by side", split is True and sp.get("a") is False
               and sp.get("b") is False and sp.get("ax") != sp.get("bx"), {"arrange": split, **sp})
        # Multitasking: open/close directly, then by gesture.
        shown = js(f"(() => {{ const s = {T}.ext()._switcher; s.show(); return s.visible; }})()")
        wait(1)
        record("Multitasking", "multitasking opens", shown is True, shown)
        js(f"{T}.ext()._switcher.hide()")
        wait(1)
        record("Multitasking", "multitasking closes", js(f"{T}.ext()._switcher.visible") is False)
        js("Main.keyboard.close?.(); true")  # the on-screen keyboard owns the bottom edge while open
        wait(1.5)
        pre = js(f"""(() => {{ const t = {T}, s = t.ext()._switcher, m = t.ext()._tabletMonitor();
            globalThis.__mutsuNav = [];
            for (const [obj, name, label] of [[s, 'show', 'switcher'], [s._dock, 'show', 'dock'],
                [s, '_quickSwitch', 'quick'], [s, '_finishPreview', 'finish']]) {{
                const orig = obj[name].bind(obj);
                obj[name] = (...a) => {{ globalThis.__mutsuNav.push(label); return orig(...a); }};
            }}
            const x = m.x + m.width / 2, y = m.y + m.height - 4;
            const target = global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.REACTIVE, x, y);
            const info = {{modal: Main.modalCount, suppressed: s._suppressed(), enabled: s._gesturesEnabled(),
                keyboard: Main.layoutManager.keyboardBox.visible, bar: s._bar.visible,
                keyFocus: `${{global.stage.key_focus}}`, kbVisible: Main.keyboard.visible,
                imFocus: !!Main.inputMethod?.currentFocus, imHasFocus: Main.inputMethod?.hasPreedit?.() ?? null,
                barRect: [...s._bar.get_transformed_position(), ...s._bar.get_transformed_size()],
                target: `${{target}}`, focus: global.display.focus_window?.get_title()}};
            t.swipe(x, y, x, m.y + m.height * 0.55, 350, 900);
            return info; }})()""")
        wait(2.5)
        gesture = js(f"({{blades: {T}.ext()._switcher.visible, nav: globalThis.__mutsuNav, drag: !!{T}.ext()._switcher._drag}})")
        gesture["before"] = pre
        record("Multitasking", "swipe up and hold opens multitasking", gesture.get("blades") is True, gesture)
        js(f"{T}.ext()._switcher.hide()")
        wait(1)

        js(f"{T}.ext()._settings.set_string('mode', 'always-desktop')")
        wait(3)
        back = js("""({a: globalThis.__mutsuOther.minimized, b: globalThis.__mutsuFocus.minimized})""")
        record(S, "unfolding keeps the split pair on screen", back.get("a") is False and back.get("b") is False, back)
    finally:
        for p in procs:
            p.terminate()


EXT_PATH = re.compile(r"/gnome-shell/extensions/([^/]+)/")


def analyze_log():
    path = os.path.join(OUT, "shell.log")
    if not os.path.exists(path):
        record("Shell log", "log exists", False)
        return
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    problems = {}
    for i, line in enumerate(lines):
        bad = ("JS ERROR" in line or "failed to start" in line or "cleanup failed" in line
               or re.search(r"\b(TypeError|ReferenceError|SyntaxError)\b", line)
               or "Unrecognized parameter" in line or "No property" in line
               or ("Extension " in line and "had error" in line))
        if not bad:
            continue
        window = " ".join(lines[i:i + 12])
        owner = EXT_PATH.search(window)
        key = owner.group(1) if owner else ("mutsu-adaptive@mutsu-os" if "Mutsu" in line else None)
        if key is None:
            continue
        problems.setdefault(key, []).append("\n".join(lines[i:i + 8]))
    if not problems:
        record("Shell log", "no extension errors", True)
    for uuid, items in sorted(problems.items()):
        unique = list(dict.fromkeys(items))
        record("Shell log", f"{uuid}: {len(unique)} error(s)", False, unique[0].splitlines()[0])
        with open(os.path.join(OUT, f"errors-{uuid}.txt"), "w") as fh:
            fh.write("\n\n".join(unique))


def write_report():
    versions = open(os.path.join(OUT, "versions.txt")).read() if os.path.exists(os.path.join(OUT, "versions.txt")) else ""
    mode = "a" if ANALYZE_ONLY else "w"
    with open(os.path.join(OUT, "report.md"), mode) as fh:
        if not ANALYZE_ONLY:
            fh.write("# GNOME runtime check\n\n```\n" + versions + "```\n")
        section = None
        for sec, name, ok, detail in results:
            if sec != section:
                fh.write(f"\n## {sec}\n\n")
                section = sec
            short = detail if len(detail) < 300 else detail[:300] + "..."
            fh.write(f"- {'✅' if ok else '❌'} {name}" + (f" — `{short}`" if short and not ok else "") + "\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary and ANALYZE_ONLY:
        shutil.copy(os.path.join(OUT, "report.md"), summary) if not os.path.exists(summary) else \
            open(summary, "a").write(open(os.path.join(OUT, "report.md")).read())


def main():
    if ANALYZE_ONLY:
        analyze_log()
    else:
        extension_states()
        try:
            tablet_flow()
        except Exception as error:  # keep going so the log is still analyzed
            record("Tablet mode", "driver", False, repr(error))
        try:
            window_flow()
        except Exception as error:
            record("Apps when folding", "driver", False, repr(error))
    write_report()
    return 0 if all(ok for _, _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
