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
    # The time lines checks up with the shell's own warnings in the log.
    print(f"{time.strftime('%H:%M:%S')} [{'PASS' if ok else 'FAIL'}] {section}: {name} {detail}", flush=True)


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


def desktop_checks():
    S = "Desktop"
    st = js("""({overview: Main.overview.visible, workspaces: global.workspace_manager.get_n_workspaces(),
        overviewSearchHidden: Main.overview.searchEntry?.opacity === 0,
        appName: Main.extensionManager.lookup('globalmenu@ShiroOSL.github.io')?.stateObj?._settings?.get_string?.('desktop-app-name') ?? null})""")
    record(S, "logs in to the desktop, not the app grid", st.get("overview") is False, st)
    record(S, "one desktop by default", st.get("workspaces") == 1, st)
    record(S, "one search: overview search box hidden", st.get("overviewSearchHidden") is True, st)
    record(S, "top-left says Mutsu on the desktop", st.get("appName") in ("Mutsu", None), st)
    if os.path.isdir("/usr/share/mutsu-os/shell-overlay/ui"):
        login = js("""({waits: typeof Main.layoutManager._mutsuWaitForExtensions === 'function',
            promise: !!Main.extensionManager.startupComplete})""")
        record(S, "login animation waits for extensions (Mutsu's Shell overlay)",
               isinstance(login, dict) and login.get("waits") is True and login.get("promise") is True, login)
        started = js("""({startingUp: Main.layoutManager._startingUp,
            uiOpacity: Main.layoutManager.uiGroup.opacity,
            uiScale: Main.layoutManager.uiGroup.scale_x})""")
        record(S, "the Shell finished starting (not left on a black screen)",
               isinstance(started, dict) and started.get("startingUp") is False
               and started.get("uiOpacity") == 255 and started.get("uiScale") == 1, started)


def look_flow():
    """What the Japandi chrome actually looks like: colours as the Shell
    resolved them, whether the rice-paper blur is attached, and screenshots
    of the desktop and quick settings (uploaded with the Shell log)."""
    S = "Look"
    js("""Main.extensionManager.lookup('mutsu-branding@mutsu-os')?.stateObj?._settings?.set_string('appearance', 'japandi')""")
    wait(2)
    facts = js("""(() => {
        const find = (actor, cls) => {
            if (actor.has_style_class_name?.(cls)) return actor;
            for (const c of actor.get_children?.() ?? []) { const f = find(c, cls); if (f) return f; }
            return null;
        };
        const colour = a => { try { return a.get_theme_node().get_background_color().to_string(); } catch (e) { return `${e}`; } };
        const dockBg = find(Main.layoutManager.uiGroup, 'dash-background');
        return {
            appearance: Main.extensionManager.lookup('mutsu-branding@mutsu-os')?.stateObj?._settings?.get_string('appearance'),
            panel: colour(Main.panel),
            panelInline: Main.panel.get_style(),
            panelBlur: !!Main.panel.get_effect('mutsu-rice-paper-blur'),
            panelEffects: Main.panel.get_effects().map(e => `${e.constructor.name}:${e.get_name?.()}`),
            dock: dockBg ? colour(dockBg) : null,
            dockInline: dockBg?.get_style() ?? null,
            dockEffects: dockBg ? dockBg.get_effects().map(e => `${e.constructor.name}:${e.get_name?.()}`) : null,
            qsBox: colour(Main.panel.statusArea.quickSettings.menu.box),
        };
    })()""")
    print("look facts:", json.dumps(facts), flush=True)
    alpha = lambda c: int(c[-2:], 16) if isinstance(c, str) and re.fullmatch(r"#[0-9a-f]{8}", c) else 255
    record(S, "top bar is see-through rice paper", isinstance(facts, dict) and alpha(facts.get("panel")) < 230, facts)
    record(S, "top bar has the rice-paper blur", isinstance(facts, dict) and facts.get("panelBlur") is True, facts)
    record(S, "dock is see-through rice paper",
           isinstance(facts, dict) and facts.get("dock") is not None and alpha(facts.get("dock")) < 230, facts)

    def shot(name):
        path = os.path.join(OUT, f"{name}.png")
        js(f"""(() => {{
            globalThis._mutsuShot = 'pending';
            const Shell = imports.gi.Shell, Gio = imports.gi.Gio;
            const file = Gio.File.new_for_path({json.dumps(path)});
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            new Shell.Screenshot().screenshot(false, stream)
                .then(() => {{ stream.close(null); globalThis._mutsuShot = 'done'; }})
                .catch(e => {{ globalThis._mutsuShot = `${{e}}`; }});
            return true;
        }})()""")
        for _ in range(20):
            wait(0.5)
            state = js("globalThis._mutsuShot")
            if state != "pending":
                break
        print(f"screenshot {name}: {state}", flush=True)

    shot("look-desktop")
    js("Main.panel.statusArea.quickSettings.menu.open(false)")
    wait(1.5)
    shot("look-quick-settings")
    js("Main.panel.statusArea.quickSettings.menu.close(false)")
    js("Main.panel.statusArea.dateMenu.menu.open(false)")
    wait(1.5)
    shot("look-calendar")
    js("Main.panel.statusArea.dateMenu.menu.close(false)")
    wait(1)


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
    docks = js("""Main.layoutManager.uiGroup.get_children().filter(a => a.name === 'dashtodockContainer')
        .map(a => a.visible)""")
    record(S, "desktop dock hidden in tablet mode (one dock: Home's)",
           isinstance(docks, list) and not any(docks), docks)
    js("Main.layoutManager.emit('monitors-changed'); true")  # what a rotation does
    wait(2)
    docks = js("""Main.layoutManager.uiGroup.get_children().filter(a => a.name === 'dashtodockContainer')
        .map(a => a.visible)""")
    record(S, "desktop dock stays hidden after the screen rotates", isinstance(docks, list) and not any(docks), docks)
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
    # In jiggle mode, drop one app on another and hold: they make a folder.
    stack = js(f"""(() => {{ const t = {T}, h = t.ext()._home;
        const apps = [...h._tiles.entries()].filter(([id, v]) => v.page === h._page && !id.startsWith('folder:'));
        if (apps.length < 3) return {{error: 'not enough apps', n: apps.length}};
        const [[aId, a], [bId, b]] = [apps[1], apps[2]];
        const before = h._layout.items.filter(i => typeof i !== 'string').length;
        const [x0, y0] = t.center(a.tile), [x1, y1] = t.center(b.tile);
        globalThis.__mutsuStack = {{aId, bId, before, during: []}};
        const GLib = imports.gi.GLib;
        for (const ms of [700, 1000, 1400])
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {{
                const d = h._drag;
                globalThis.__mutsuStack.during.push(d ? {{onto: d.onto, ready: d.folderReady ?? null,
                    target: d.target, pending: d.pending}} : null);
                return GLib.SOURCE_REMOVE; }});
        t.swipe(x0, y0, x1, y1, 500, 1100); return {{aId, bId, before}}; }})()""")
    wait(3)
    folder = js(f"""(() => {{ const h = {T}.ext()._home, s = globalThis.__mutsuStack;
        const folders = h._layout.items.filter(i => typeof i !== 'string');
        const made = folders.find(f => f.apps.includes(s.aId) && f.apps.includes(s.bId));
        return {{folders: folders.length, before: s.before, made: made ? made.name : null,
            during: s.during}}; }})()""")
    record(S, "stacking a wiggling app on another makes a folder",
           isinstance(folder, dict) and folder.get("made") is not None, {"stack": stack, "result": folder})
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
        chin = js(f"""(() => {{ const t = {T}, s = t.ext()._switcher._blades;
            const out = [];
            for (const blade of s._blades ?? []) {{
                // Measured in the card's own coordinates: side cards are scaled
                // and easing, and stage-space reads of a mid-ease card are stale.
                const chin = t.find(blade, a => a.has_style_class_name?.('mutsu-blade-actions'));
                if (!chin) {{ out.push('no chin'); continue; }}
                let cy = 0;
                for (let a = chin; a && a !== blade; a = a.get_parent()) cy += a.y;
                out.push({{cardBottom: Math.round(blade.height), chinBottom: Math.round(cy + chin.height),
                    chinTop: Math.round(cy), scale: +blade.scale_y.toFixed(2)}});
            }}
            return out; }})()""")
        record("Multitasking", "Split View / Slide Over sit inside the card's chin",
               isinstance(chin, list) and chin and all(isinstance(c, dict) and c["chinBottom"] <= c["cardBottom"] + 1
                                                         and c["chinTop"] >= c["cardBottom"] - 80 for c in chin), chin)
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
        slide_flow(T)
    finally:
        for p in procs:
            p.terminate()


def slide_flow(T):
    S = "Slide Over"
    js(f"{T}.ext()._settings.set_string('mode', 'always-tablet')")
    wait(3)
    ok = js(f"{T}.ext()._switcher.split.slideOver(globalThis.__mutsuOther)")
    wait(1.5)
    st = js(f"""(() => {{ const s = {T}.ext()._switcher.split, w = globalThis.__mutsuOther, r = w.get_frame_rect();
        return {{ok: {str(True).lower()}, min: w.minimized, handle: s._handle.visible, x: r.x, y: r.y, w: r.width,
            hx: s._handle.x}}; }})()""")
    record(S, "opens as a floating app with its handle", ok is True and st.get("min") is False and st.get("handle"), {**st, "slideOver": ok})
    # Slow drag of the handle: moves sideways only.
    js(f"""(() => {{ const t = {T}, h = t.ext()._switcher.split._handle;
        const [x, y] = t.center(h); t.swipe(x, y, x - 250, y + 40, 900); return true; }})()""")
    wait(2)
    moved = js("""(() => { const r = globalThis.__mutsuOther.get_frame_rect();
        return {x: r.x, y: r.y, w: r.width, min: globalThis.__mutsuOther.minimized}; })()""")
    record(S, "dragging the handle moves the app sideways at the same size",
           moved.get("min") is False and moved.get("x", 0) < st.get("x", 0) - 100
           and moved.get("y") == st.get("y") and moved.get("w") == st.get("w"), {"before": st, "after": moved})
    def flick(direction):
        """Flick the newest Slide Over app's handle; record whether GNOME's
        minimize animation ran and the window's sideways offset mid-tuck."""
        js(f"""(() => {{ const t = {T}, s = t.ext()._switcher.split, h = s._handle, w = s.front;
            const wm = Main.wm, orig = wm._shouldAnimateActor; globalThis.__mutsuOrigAnim = orig;
            globalThis.__mutsuAnim = []; globalThis.__mutsuTx = []; globalThis.__mutsuFlicked = w;
            wm._shouldAnimateActor = function (a, types) {{
                const r = orig.call(this, a, types);
                if (a?.meta_window === w) globalThis.__mutsuAnim.push(r);
                return r; }};
            const GLib = imports.gi.GLib;
            for (const ms of [150, 200, 250])
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {{
                    globalThis.__mutsuTx.push(Math.round(w.get_compositor_private()?.translation_x ?? 0));
                    return GLib.SOURCE_REMOVE; }});
            const [x, y] = t.center(h); t.swipe(x, y, x + ({direction}) * 300, y, 70); return true; }})()""")
        wait(2)
        return js(f"""(() => {{ const s = {T}.ext()._switcher.split, w = globalThis.__mutsuFlicked;
            Main.wm._shouldAnimateActor = globalThis.__mutsuOrigAnim;
            return {{min: w.minimized, left: s.tuckedOn('left') === w, right: s.tuckedOn('right') === w,
                tabLeft: s.tabs.left.visible, tabRight: s.tabs.right.visible,
                gnomeMinimizeAnimation: globalThis.__mutsuAnim, slideOffsets: globalThis.__mutsuTx}}; }})()""")

    def tap_tab(side):
        """Tap an edge's arrow; returns what the returning app's actor did
        while sliding back (sideways offset, scale, position)."""
        js(f"""(() => {{ const t = {T}, s = t.ext()._switcher.split, tab = s.tabs.{side};
            const w = s.tuckedOn('{side}'); globalThis.__mutsuBack = [];
            const GLib = imports.gi.GLib;
            for (let ms = 20; ms <= 600; ms += 20)
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {{
                    const a = w?.get_compositor_private();
                    // While it slides, what's on screen is the window's picture.
                    const c = a?._mutsuSlideClone;
                    if (c) globalThis.__mutsuBack.push({{tx: Math.round(c.translation_x),
                        x: Math.round(c.x), y: Math.round(c.y), scale: +c.scale_x.toFixed(2),
                        opacity: c.opacity, clone: true, real: a.opacity}});
                    else if (a) globalThis.__mutsuBack.push({{tx: Math.round(a.translation_x),
                        x: Math.round(a.x), y: Math.round(a.y), scale: +a.scale_x.toFixed(2),
                        opacity: a.opacity}});
                    return GLib.SOURCE_REMOVE; }});
            const [x, y] = t.center(tab); t.tap(x, y); return true; }})()""")
        wait(2)
        return js("globalThis.__mutsuBack")

    def came_back_from(samples, side):
        """On screen the app moved in from `side` the whole way (judged by
        where it was drawn: actor position plus offset) and never zoomed."""
        if not isinstance(samples, list) or not samples:
            return False
        visible = [p for p in samples if p.get("opacity", 0) > 0]
        if not visible:
            return False
        drawn = [p["x"] + p["tx"] for p in visible]
        final = drawn[-1]
        sign = 1 if side == "right" else -1
        started_beside = sign * (drawn[0] - final) > 50
        one_way = all(sign * (a - b) >= -2 for a, b in zip(drawn, drawn[1:]))
        never_past = all(sign * (d - final) >= -2 for d in drawn)
        no_zoom = all(p["scale"] == 1 for p in visible) and not any(
            p["x"] < 20 and p["y"] < 20 and p["tx"] == 0 for p in visible[:-1])
        # Never two copies: the real window stays hidden while its picture moves.
        one_copy = all(p.get("real", 0) == 0 for p in visible if p.get("clone"))
        return started_beside and one_way and never_past and no_zoom and one_copy

    # Flick right: tucks off the right edge (folds off the side, not GNOME's
    # minimize-into-the-dock animation), arrow tab on that edge.
    tucked = flick(1)
    record(S, "a quick flick right tucks it away to the right", tucked.get("min") is True
           and tucked.get("right") and tucked.get("tabRight"), tucked)
    record(S, "tucking right slides off the right edge (no minimize-to-dock animation)",
           True not in (tucked.get("gnomeMinimizeAnimation") or [])
           and any(v > 50 for v in (tucked.get("slideOffsets") or [])), tucked)
    slid = tap_tab("right")
    back = js(f"({{min: globalThis.__mutsuOther.minimized, tab: {T}.ext()._switcher.split.tabs.right.visible}})")
    record(S, "tapping the arrow slides it back", back.get("min") is False and back.get("tab") is False, back)
    record(S, "the right arrow brings it back in from the right (no zoom from a corner)",
           came_back_from(slid, "right"), slid)
    # Flick left: off the left edge, moving left the whole way.
    left = flick(-1)
    record(S, "a quick flick left tucks it away to the left, sliding left",
           left.get("min") is True and left.get("left") and left.get("tabLeft")
           and any(v < -50 for v in (left.get("slideOffsets") or []))
           and not any(v > 0 for v in (left.get("slideOffsets") or [])), left)
    tap_tab("left")
    # Dragged slowly most of the way off the left edge: tucks left too (the
    # side it was dragged off decides, not how fast).
    slow = js(f"""(() => {{ const t = {T}, s = t.ext()._switcher.split, h = s._handle, w = s.front;
        globalThis.__mutsuSlow = w; const [x, y] = t.center(h);
        t.swipe(x, y, x - 1100, y, 1600); return true; }})()""")
    wait(2.5)
    slow = js(f"""(() => {{ const s = {T}.ext()._switcher.split, w = globalThis.__mutsuSlow;
        return {{min: w.minimized, left: s.tuckedOn('left') === w,
            opacity: w.get_compositor_private()?.opacity}}; }})()""")
    record(S, "dragged slowly off the left edge, it tucks away to the left",
           slow.get("min") is True and slow.get("left"), slow)
    slid = tap_tab("left")
    record(S, "the left arrow brings it back in from the left (no zoom from a corner)",
           came_back_from(slid, "left"), slid)
    # Now at the left end: flick it right, call it back with the right
    # arrow. It must arrive from the right, not from where it used to sit.
    across = flick(1)
    slid = tap_tab("right")
    record(S, "an app from the left end, tucked right, comes back in from the right",
           across.get("right") and came_back_from(slid, "right"), {"tuck": across, "back": slid})
    back = js("""(() => { const w = globalThis.__mutsuSlow, a = w.get_compositor_private();
        return {min: w.minimized, opacity: a?.opacity, tx: Math.round(a?.translation_x ?? 0)}; })()""")
    record(S, "brought back by its arrow, fully visible in place",
           back.get("min") is False and back.get("opacity") == 255 and back.get("tx") == 0, back)
    # Two Slide Over apps share the row without overlapping; with one edge
    # taken, the second tucks away off the other edge.
    js(f"{T}.ext()._switcher.split.slideOver(globalThis.__mutsuFocus)")
    wait(1.5)
    two = js(f"""(() => {{ const s = {T}.ext()._switcher.split;
        const r = s.slides.map(w => w.get_frame_rect()).sort((a, b) => a.x - b.x);
        return {{count: s.slides.length, min: s.slides.map(w => w.minimized),
            gap: r.length === 2 ? r[1].x - (r[0].x + r[0].width) : null}}; }})()""")
    record(S, "two Slide Over apps sit side by side without overlapping",
           two.get("count") == 2 and two.get("min") == [False, False] and (two.get("gap") or -1) >= 0, two)
    first = flick(1)
    second = flick(1)
    record(S, "second app flicked to a taken edge tucks away off the other edge",
           first.get("right") and second.get("left") and second.get("tabLeft") and first.get("tabRight")
           and any(v < -50 for v in (second.get("slideOffsets") or [])), {"first": first, "second": second})
    # Leaving tablet mode with a Slide Over app on screen: it folds off its
    # edge (no GNOME minimize into the dock) and waits minimized.
    tap_tab("right")
    js(f"""(() => {{ const s = {T}.ext()._switcher.split, w = s.front, wm = Main.wm, orig = wm._shouldAnimateActor; globalThis.__mutsuOrigAnim = orig;
        globalThis.__mutsuExitWin = w; globalThis.__mutsuAnim = [];
        wm._shouldAnimateActor = function (a, types) {{
            const r = orig.call(this, a, types);
            if (a?.meta_window === w) globalThis.__mutsuAnim.push(r);
            return r; }};
        {T}.ext()._settings.set_string('mode', 'always-desktop'); return true; }})()""")
    wait(2.5)
    out = js("""(() => { Main.wm._shouldAnimateActor = globalThis.__mutsuOrigAnim;
        return {min: globalThis.__mutsuExitWin?.minimized, gnomeMinimizeAnimation: globalThis.__mutsuAnim,
            above: globalThis.__mutsuExitWin?.is_above?.()}; })()""")
    record(S, "leaving tablet mode folds Slide Over away (no minimize-to-dock animation)",
           out.get("min") is True and True not in (out.get("gnomeMinimizeAnimation") or [])
           and not out.get("above"), out)
    # Back in tablet mode, a minimized app put in Slide Over slides in from
    # its edge instead of GNOME's zoom out of the dock.
    js(f"{T}.ext()._settings.set_string('mode', 'always-tablet')")
    wait(3)
    js(f"""(() => {{ const w = globalThis.__mutsuExitWin, wm = Main.wm;
        globalThis.__mutsuAnim = []; globalThis.__mutsuTx = [];
        const GLib = imports.gi.GLib;
        if (!w.minimized) w.minimize();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {{
            globalThis.__mutsuAnim = [];
            {T}.ext()._switcher.split.slideOver(w);
            for (const ms of [40, 90, 140])
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {{
                    const a = w.get_compositor_private();
                    // The slide moves the window's picture (or the window).
                    const c = a?._mutsuSlideClone;
                    globalThis.__mutsuTx.push(Math.round((c ?? a)?.translation_x ?? 0));
                    // Is GNOME running its unminimize (zoom out of the dock)?
                    globalThis.__mutsuAnim.push(!!a && wm._unminimizing.has(a));
                    return GLib.SOURCE_REMOVE; }});
            return GLib.SOURCE_REMOVE; }});
        return true; }})()""")
    wait(2.5)
    came = js("""(() => {
        return {min: globalThis.__mutsuExitWin.minimized, gnomeUnminimizeAnimation: globalThis.__mutsuAnim,
            slideOffsets: globalThis.__mutsuTx}; })()""")
    record(S, "a minimized app put in Slide Over slides in from the edge (no zoom out of the dock)",
           came.get("min") is False and True not in (came.get("gnomeUnminimizeAnimation") or [])
           and any(abs(v) > 30 for v in (came.get("slideOffsets") or [])), came)
    js(f"{T}.ext()._settings.set_string('mode', 'always-desktop')")
    wait(2)


EXT_PATH = re.compile(r"/gnome-shell/extensions/([^/]+)/")


def gamepad_flow():
    """On-screen gamepad over a 'Steam game' window in tablet mode."""
    S = "On-screen gamepad"
    if not shutil.which("gjs"):
        record(S, "test app available", False, "no gjs in the image")
        return
    T = "globalThis.__mutsuTest"
    js(f"{T}.ext()._settings.set_string('mode', 'always-tablet')")
    wait(3)
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-window.js")
    proc = subprocess.Popen(["gjs", "-m", script, "Game", "steam_app_570"], stdout=subprocess.DEVNULL,
                            stderr=open(os.path.join(OUT, "test-window-game.log"), "w"))
    try:
        state = None
        for _ in range(20):
            wait(1)
            state = js(f"""(() => {{ const w = global.display.focus_window, g = {T}.ext()._gamepad;
                return {{cls: w?.get_wm_class?.() ?? null, visible: !!g?.visible}}; }})()""")
            if isinstance(state, dict) and state.get("visible"):
                break
        record(S, "appears over a game Steam launched", isinstance(state, dict) and state.get("visible"), state)
        if not (isinstance(state, dict) and state.get("visible")):
            return
        # A real controller on the CI host would step the overlay aside; note
        # what it saw, then act as if none were plugged in.
        pads = js(f"""(() => {{ const g = {T}.ext()._gamepad;
            const seen = {{padsConnected: g._padsConnected, autoHidden: g.autoHidden}};
            try {{
                const [, bytes] = imports.gi.Gio.File.new_for_path('/proc/bus/input/devices').load_contents(null);
                seen.js = new TextDecoder().decode(bytes).split(/\\n\\s*\\n/)
                    .filter(b => /Handlers=.*\\bjs\\d/.test(b))
                    .map(b => (/N: Name="([^"]*)"/.exec(b)?.[1] ?? '?') + ' KEY=' + (/B: KEY=(.*)/.exec(b)?.[1] ?? '-'));
            }} catch (e) {{ seen.js = String(e); }}
            g._padsConnected = false; g._sync();
            seen.controls = (g._controls ?? []).filter(a => a.visible).length;
            return seen; }})()""")
        record(S, "controls show when no real controller is plugged in",
               isinstance(pads, dict) and pads.get("controls", 0) > 0, pads)
        # Record what would go to the virtual controller.
        js(f"""(() => {{ const g = {T}.ext()._gamepad; globalThis.__mutsuPad = [];
            g._helper = null; g._spawn = () => ({{write: l => globalThis.__mutsuPad.push(l.trim()), close() {{}}}});
            return true; }})()""")
        js(f"""(() => {{ const t = {T}, g = t.ext()._gamepad, b = g.layout.buttons.a;
            t.tap(b.cx, b.cy); return true; }})()""")
        wait(1)
        js(f"""(() => {{ const t = {T}, s = {T}.ext()._gamepad.layout.stick;
            t.swipe(s.cx, s.cy, s.cx + s.radius * 2, s.cy, 300); return true; }})()""")
        wait(1.5)
        sent = js("globalThis.__mutsuPad")
        record(S, "tapping A presses and releases A", isinstance(sent, list) and "k a 1" in sent and "k a 0" in sent, sent)
        record(S, "dragging the circle pad tilts the stick and recentres",
               isinstance(sent, list) and any(l.startswith("a lx 32767") for l in sent)
               and "a lx 0;a ly 0" in sent, sent)
        # Swap to the GameCube layout and the D-pad with the chips.
        for chip in ("toggle:face", "toggle:left"):
            js(f"""(() => {{ const t = {T}, g = t.ext()._gamepad;
                const a = [...g._hits.entries()].find(([, v]) => v === '{chip}')[0];
                const [x, y] = t.center(a); t.tap(x, y); return true; }})()""")
            wait(1)
        layout = js(f"""(() => {{ const L = {T}.ext()._gamepad.layout;
            return {{face: L.face, left: L.left, dpad: !!L.dpad}}; }})()""")
        record(S, "chips swap to the GameCube layout and the D-pad",
               layout == {"face": "gamecube", "left": "dpad", "dpad": True}, layout)
        saved = js(f"{T}.ext()._settings.get_string('gamepad-games')")
        if not isinstance(saved, str):
            saved = json.dumps(saved)
        record(S, "the swapped layout is remembered for this game",
               isinstance(saved, str) and '"steam_app_570"' in saved and 'gamecube' in saved, saved)
        js(f"{T}.ext()._settings.set_string('gamepad-games', '{{}}')")
    finally:
        proc.terminate()
        wait(1)
        js(f"{T}.ext()._settings.set_string('mode', 'always-desktop')")
        wait(1)


def mode_animation_flow():
    """The desktop <-> tablet switch animation plays and cleans up."""
    S = "Switch animation"
    T = "globalThis.__mutsuTest"
    js(f"{T}.ext()._settings.set_string('mode', 'always-desktop')")
    wait(2.5)

    def sample(to):
        js(f"""(() => {{ globalThis.__mutsuAnimSeen = []; const GLib = imports.gi.GLib;
            {T}.ext()._settings.set_string('mode', '{to}');
            // After the 400 ms debounce and the switch itself.
            for (const ms of [650, 850, 1050, 1300])
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {{
                    const kids = Main.layoutManager.uiGroup.get_children();
                    const hud = kids.find(a => a.has_style_class_name?.('mutsu-mode-hud'));
                    const label = hud?.get_children().find(c => c.text)?.text ?? null;
                    globalThis.__mutsuAnimSeen.push({{
                        wave: kids.some(a => a.has_style_class_name?.('mutsu-mode-wave')),
                        hud: !!hud, label, scale: +global.window_group.scale_x.toFixed(3)}});
                    return GLib.SOURCE_REMOVE; }});
            return true; }})()""")
        wait(3)
        after = js("""(() => { const kids = Main.layoutManager.uiGroup.get_children();
            return {left: kids.filter(a => a.has_style_class_name?.('mutsu-mode-wave') ||
                a.has_style_class_name?.('mutsu-mode-hud')).length,
                scale: global.window_group.scale_x}; })()""")
        return js("globalThis.__mutsuAnimSeen"), after

    def timings(label):
        """How long the switch kept the Shell busy (the journal has the same)."""
        got = js(f"{T}.ext()._lastSwitch ?? null")
        total = got.get("total") if isinstance(got, dict) else None
        # A virtual machine without a GPU: generous. On hardware it's far less.
        record(S, f"{label}: the switch itself is quick (under 400 ms here)",
               isinstance(total, (int, float)) and total < 400, got)

    seen, after = sample("always-tablet")
    timings("into tablet")
    record(S, "into tablet: wave, folding hinge labelled Tablet",
           isinstance(seen, list) and any(s.get("hud") and s.get("label") == "Tablet" for s in seen)
           and any(s.get("wave") for s in seen), seen)
    record(S, "cleans up and leaves the apps at full size",
           after.get("left") == 0 and after.get("scale") == 1, after)
    seen, after = sample("always-desktop")
    timings("back to desktop")
    record(S, "back to desktop: labelled Desktop, cleaned up",
           isinstance(seen, list) and any(s.get("label") == "Desktop" for s in seen)
           and after.get("left") == 0 and after.get("scale") == 1, {"seen": seen, "after": after})


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
        if key is None and re.search(r"\b(TypeError|ReferenceError|SyntaxError)\b", line):
            # No extension in the stack: GNOME Shell's own code, which Mutsu
            # patches (the login overlay). A TypeError there blacked out login.
            key = "GNOME Shell"
        if key is None:
            continue
        problems.setdefault(key, []).append("\n".join(lines[i:i + 8]))
    # Clutter / Cogl warnings, printed for diagnosis (not a failure yet):
    # which actors trip "needs an allocation" or a zero-size viewport.
    noisy = [line for line in lines if re.search(
        r"needs an allocation|set_viewport|BrightnessContrastEffect|application_id|Clutter-(WARNING|CRITICAL)|"
        r"Cogl-(WARNING|CRITICAL)|St-(WARNING|CRITICAL)", line)]
    print(f"Clutter/Cogl/St warnings: {len(noisy)}")
    for line in list(dict.fromkeys(noisy))[:25]:
        print("  " + line[:300])
    if not problems:
        record("Shell log", "no extension errors", True)
    for uuid, items in sorted(problems.items()):
        unique = list(dict.fromkeys(items))
        record("Shell log", f"{uuid}: {len(unique)} error(s)", False, unique[0].splitlines()[0])
        # The whole stack, so the log shows where it came from.
        for item in unique[:3]:
            print("\n".join("    " + l[:300] for l in item.splitlines()))
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
            desktop_checks()
        except Exception as error:
            record("Desktop", "driver", False, repr(error))
        try:
            look_flow()
        except Exception as error:
            record("Look", "driver", False, repr(error))
        try:
            tablet_flow()
        except Exception as error:  # keep going so the log is still analyzed
            record("Tablet mode", "driver", False, repr(error))
        try:
            window_flow()
        except Exception as error:
            record("Apps when folding", "driver", False, repr(error))
        try:
            mode_animation_flow()
        except Exception as error:
            record("Switch animation", "driver", False, repr(error))
        try:
            gamepad_flow()
        except Exception as error:
            record("On-screen gamepad", "driver", False, repr(error))
    write_report()
    return 0 if all(ok for _, _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
