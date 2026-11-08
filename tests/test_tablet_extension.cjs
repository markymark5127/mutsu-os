// Extension lifecycle: posture/mode decisions, the Quick Settings override,
// lock handling, Home parking, window sizing and crash-safe settings.
//   node tests/test_tablet_extension.cjs extensions/mutsu-adaptive@mutsu-os
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const strip = file => fs.readFileSync(path.join(folder, file), 'utf8')
    .replace(/^import [\s\S]*?;\r?\n/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');

class Emitter {
    constructor() { this._h = new Map(); this._n = 0; }
    connect(name, fn) { this._h.set(++this._n, [name, fn]); return this._n; }
    disconnect(id) { this._h.delete(id); }
    emit(name, ...args) { for (const [n, fn] of [...this._h.values()]) if (n === name) fn(this, ...args); }
    get count() { return this._h.size; }
}
const geometry = new Function(`${strip('tabletGeometry.js')}; return {resolveTablet, maximizeWindow,
    unmaximizeWindow, isWindowMaximized, hingeTablet, hingeFromAccels, planTabletEntry, planTabletExit};`)();
const {SettingsJournal} = new Function(`${strip('settingsJournal.js')}; return {SettingsJournal};`)();
const {PostureMonitor} = new Function('hingeTablet', 'hingeFromAccels',
    `${strip('posture.js')}; return {PostureMonitor};`)(geometry.hingeTablet, geometry.hingeFromAccels);

let timers = new Map(), tid = 0;
const GLib = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
    timeout_add: (_p, _ms, fn) => { timers.set(++tid, fn); return tid; },
    timeout_add_seconds: (_p, _s, fn) => { timers.set(++tid, fn); return tid; },
    idle_add: (_p, fn) => { timers.set(++tid, fn); return tid; },
    source_remove: id => timers.delete(id), file_get_contents: () => { throw new Error('no'); },
    file_test: () => true, FileTest: {IS_EXECUTABLE: 0},
    Variant: {parse: (_t, text) => ({text, print: () => text, unpack: () => Number(text)})}};
const flush = () => { while (timers.size) { const t = [...timers.values()]; timers.clear(); t.forEach(f => f()); } };

// System settings store shared across "sessions" (dconf).
const dconf = {};
class FakeSettings extends Emitter {
    constructor(id, keys) { super(); this.id = id; this.settings_schema = {has_key: k => keys.includes(k)}; }
    get_user_value(k) { const v = dconf[`${this.id}/${k}`]; return v === undefined ? null :
        {print: () => String(v), unpack: () => v}; }
    set_value(k, variant) { dconf[`${this.id}/${k}`] = variant.text; }
    set_boolean(k, v) { dconf[`${this.id}/${k}`] = v; }
    set_double(k, v) { dconf[`${this.id}/${k}`] = v; }
    set_string(k, v) { dconf[`${this.id}/${k}`] = v; }
    reset(k) { delete dconf[`${this.id}/${k}`]; }
}
const schemas = {
    'org.gnome.desktop.interface': ['text-scaling-factor'],
    'org.gnome.shell.extensions.touchshell': ['top-right-swipe-activation', 'bottom-edge-swipe-activation',
        'auto-maximize-windows-activation'],
    'org.gnome.desktop.a11y.applications': ['screen-keyboard-enabled'],
};
const Gio = {
    SettingsSchemaSource: {get_default: () => ({lookup: id => schemas[id] ? id : null}),
        new_from_directory: () => ({lookup: () => null})},
    Settings: class { constructor({settings_schema}) { return new FakeSettings(settings_schema, schemas[settings_schema]); } },
    File: {new_for_path: () => ({enumerate_children: () => { throw new Error('none'); }})},
    FileQueryInfoFlags: {NONE: 0}, Subprocess: {new: () => ({})}, SubprocessFlags: {NONE: 0},
};

const ext = Object.assign(new Emitter(), {values: {'mode': 'automatic', 'saved-state': '', 'open-home-on-tablet': false,
    'touch-text-scale': 1.15, 'rotation-lock': false, 'collapse-dock-in-tablet': true,
    'enable-experimental-gestures': true, 'automatic-keyboard': true, 'gesture-exceptions': []}});
Object.assign(ext, {get_string(k) { return this.values[k]; }, get_boolean(k) { return this.values[k]; }, get_int(k) { return this.values[k] ?? 0; },
    get_double(k) { return this.values[k]; }, get_strv(k) { return this.values[k]; },
    set_string(k, v) { this.values[k] = v; this.emit(`changed::${k}`); }});

const sessionMode = Object.assign(new Emitter(), {isLocked: false, isGreeter: false});
const monitor = {x: 0, y: 0, width: 1280, height: 800};
const overview = Object.assign(new Emitter(), {visible: false, hide() { this.visible = false; }});
class Actor extends Emitter {
    constructor() { super(); this.visible = true; this.classes = new Set(); }
    add_child() {} destroy() { this.destroyed = true; }
    add_style_class_name(c) { this.classes.add(c); } remove_style_class_name(c) { this.classes.delete(c); }
}
const panel = Object.assign(new Actor(), {statusArea: {activities: new Actor(), appMenu: new Actor(),
    quickSettings: {menu: {addItem() {}}}}, addToStatusArea() {}});
const Main = {sessionMode, overview, panel, notify() {},
    layoutManager: {monitors: [monitor], primaryMonitor: monitor},
    extensionManager: {lookup: () => null}};
class MenuButton extends Actor {
    constructor() { super(); this.menu = {items: [], addAction(label, fn) {
        const item = {label, fn, setOrnament(o) { this.ornament = o; }}; this.items.push(item); return item; },
        addMenuItem() {}}; }
}
class QuickToggle extends Emitter { constructor() { super(); this.checked = false; this.visible = true; } destroy() {} }

const instances = {home: 0, switcher: 0, session: 0};
const chrome = [];
let lastHome = null;
class TabletHome { constructor() { instances.home++; lastHome = this; this.reveals = 0; }
    reveal() { this.reveals++; } setEditing() {} destroy() { instances.home--; } }
class TabletSwitcher { constructor() { instances.switcher++; } show() {} hide() {} destroy() { instances.switcher--; } }
class TabletSession {
    constructor(settings, journal) { instances.session++;
        journal.change('org.gnome.desktop.a11y.applications', 'screen-keyboard-enabled',
            s => s.set_boolean('screen-keyboard-enabled', true)); }
    destroy() { instances.session--; } }

const windows = [];
const display = Object.assign(new Emitter(), {focus_window: null, get_tab_list: () => windows});
let nextId = 0;
function makeWindow({maximized = false, resizable = true} = {}) {
    const w = Object.assign(new Emitter(), {id: nextId++, maximized, minimized: false,
        get_gtk_application_id: () => 'org.example.App', get_title: () => 'Doc',
        get_window_type: () => 0, is_skip_taskbar: () => false, get_transient_for: () => null,
        allows_resize: () => resizable, get_monitor: () => 0, is_on_all_workspaces: () => false,
        get_workspace: () => ({active: true}), is_maximized() { return this.maximized; },
        maximize() { this.maximized = true; }, unmaximize() { this.maximized = false; },
        minimize() { this.minimized = true; this.emit('notify::minimized'); },
        unminimize() { this.minimized = false; this.emit('notify::minimized'); }});
    windows.push(w);
    return w;
}
const seat = Object.assign(new Emitter(), {touch_mode: false});
const globalMock = {display, stage: {get_context: () => ({get_backend: () => ({get_default_seat: () => seat})})},
    backend: {get_monitor_manager: () => ({get_monitor_for_connector: () => -1})}};

const source = strip('extension.js').replace('class MutsuAdaptiveExtension extends Extension',
    'class MutsuAdaptiveExtension extends Extension');
const Extension = class { constructor() { this.uuid = 'mutsu-adaptive@mutsu-os'; } getSettings() { return ext; } };
const Ext = new Function('Extension', 'Main', 'PanelMenu', 'PopupMenu', 'QuickSettings', 'St', 'Gio', 'GLib',
    'Meta', 'Clutter', 'TabletSwitcher', 'TabletHome', 'applyTabletDock', 'DOCK_SCHEMA', 'TabletSession',
    'SettingsJournal', 'PostureMonitor', 'maximizeWindow', 'unmaximizeWindow', 'isWindowMaximized',
    'resolveTablet', 'global', 'log', 'TextDecoder', 'setTabletWindowChrome',
    'planTabletEntry', 'planTabletExit', 'logError',
    `${source}; return MutsuAdaptiveExtension;`)(
    Extension, Main, {Button: MenuButton}, {PopupSeparatorMenuItem: class {}, Ornament: {CHECK: 'check', NONE: 'none'}},
    {QuickToggle}, {Icon: Actor}, Gio, GLib, {TabList: {NORMAL_ALL: 0}, WindowType: {NORMAL: 0}},
    {}, TabletSwitcher, TabletHome, () => () => {}, 'org.gnome.shell.extensions.dash-to-dock',
    TabletSession, SettingsJournal, PostureMonitor, geometry.maximizeWindow, geometry.unmaximizeWindow,
    geometry.isWindowMaximized, geometry.resolveTablet, globalMock, () => {}, TextDecoder,
    on => chrome.push(on), geometry.planTabletEntry, geometry.planTabletExit, e => { throw e; });

dconf['org.gnome.shell.extensions.touchshell/bottom-edge-swipe-activation'] = "'always'";
const before = makeWindow();
const wasMax = makeWindow({maximized: true});
const e = new Ext();
e.enable();
assert.equal(instances.home, 0, 'laptop posture: desktop');
assert.equal(e._qsToggle.checked, false);

// Fold the laptop.
seat.touch_mode = true;
seat.emit('notify::touch-mode');
flush();
assert.equal(instances.home, 1, 'fold enters tablet mode');
assert.equal(e._qsToggle.checked, true);
assert.equal(dconf['org.gnome.desktop.interface/text-scaling-factor'], 1.15, 'touch text size');
assert.equal(dconf['org.gnome.shell.extensions.touchshell/bottom-edge-swipe-activation'], 'off',
    'Touchshell schema opened safely and its bottom edge handed to Mutsu');
assert.equal(dconf['org.gnome.desktop.a11y.applications/screen-keyboard-enabled'], true);
assert(ext.values['saved-state'].includes('text-scaling-factor'), 'originals saved to disk first');
assert.equal(before.minimized, false, 'the app in use stays open');
assert.equal(before.maximized, true, '...full screen');
assert.equal(wasMax.minimized, true, 'other apps wait in multitasking');
assert(panel.classes.has('mutsu-status-slim'));
assert.deepEqual(chrome, [false, true], 'desktop controls reset at start, finger-sized in tablet');

// New window: maximized once shown; a fixed-size one is left alone.
const created = makeWindow();
display.emit('window-created', created);
created.emit('shown');
assert.equal(created.maximized, true);
const fixed = makeWindow({resizable: false});
display.emit('window-created', fixed);
fixed.emit('shown');
assert.equal(fixed.maximized, false, 'fixed-size windows are not forced');

// Quick Settings toggle in Automatic: temporary override, Automatic kept.
e._toggleManual();
flush();
assert.equal(instances.home, 0, 'toggle leaves tablet mode while folded');
assert.equal(ext.values.mode, 'automatic', 'Automatic is not lost');
assert.equal(before.minimized, false, 'the app on screen stays on the desktop');
assert.equal(wasMax.minimized, true, 'apps in multitasking stay minimized');
assert.equal(before.maximized, false, 'pre-existing windows get their desktop size back');
assert.equal(wasMax.maximized, true, '...and maximized ones stay maximized');
assert.equal(created.maximized, true, 'windows opened in tablet mode stay as they are');
assert.equal(dconf['org.gnome.desktop.interface/text-scaling-factor'], undefined, 'text size restored');
assert.equal(dconf['org.gnome.shell.extensions.touchshell/bottom-edge-swipe-activation'], "'always'",
    'Touchshell restored to the user value');
assert.equal(ext.values['saved-state'], '{}');
assert.equal(chrome.at(-1), false, 'window controls back to desktop size');
// Next real posture change clears the override.
seat.touch_mode = false; seat.emit('notify::touch-mode'); flush();
seat.touch_mode = true; seat.emit('notify::touch-mode'); flush();
assert.equal(instances.home, 1, 'folding again follows the hinge');

// Choosing Automatic while folded stays in tablet (used to drop to desktop).
ext.set_string('mode', 'always-desktop'); flush();
assert.equal(instances.home, 0);
ext.set_string('mode', 'automatic'); flush();
assert.equal(instances.home, 1, 'Automatic while folded means tablet');

// The Quick Settings toggle from a forced mode returns to Automatic, so
// folding keeps working afterwards.
ext.set_string('mode', 'always-desktop'); flush();
e._toggleManual(); flush();
assert.equal(ext.values.mode, 'automatic', 'toggle never leaves a forced mode behind');
assert.equal(instances.home, 1, 'toggle turned tablet mode on');
seat.touch_mode = false; seat.emit('notify::touch-mode'); flush();
assert.equal(instances.home, 0, 'unfolding after the toggle follows the hinge');
seat.touch_mode = true; seat.emit('notify::touch-mode'); flush();
assert.equal(instances.home, 1, 'folding after the toggle follows the hinge');

// Locking keeps tablet mode; only chrome hides.
sessionMode.isLocked = true; sessionMode.emit('updated');
assert.equal(instances.home, 1, 'lock does not tear tablet mode down');
assert(JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8'))['session-modes']
    .includes('unlock-dialog'), 'GNOME keeps the extension enabled on the lock screen');
assert.equal(e._indicator.visible, false);
sessionMode.isLocked = false; sessionMode.emit('updated');
assert.equal(e._indicator.visible, true);

// Super key / overview goes Home.
const reveals = lastHome.reveals;
overview.visible = true; overview.emit('showing'); flush();
assert.equal(overview.visible, false);
assert.equal(lastHome.reveals, reveals + 1);

// Simulated Shell crash in tablet mode: no disable(), new session starts.
const crashState = ext.values['saved-state'];
assert(crashState.length > 2);
const e2 = new Ext();
seat.touch_mode = false;
e2.enable();
assert.equal(dconf['org.gnome.desktop.interface/text-scaling-factor'], undefined,
    'next start restores settings left by the crash');
assert.equal(dconf['org.gnome.shell.extensions.touchshell/bottom-edge-swipe-activation'], "'always'");
e2.disable();
e.disable();
assert.equal(instances.home, 0);
assert.equal(seat.count, 0, 'posture signal disconnected');
assert.equal(ext.count, 0, 'settings signals disconnected');
console.log('Tablet extension checks passed (fold, override, Automatic kept, restore sizes, lock, overview, crash recovery, cleanup).');
