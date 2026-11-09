const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
class Emitter {
    constructor() { this.signals = new Map(); this.next = 0; }
    connect(name, fn) { this.signals.set(++this.next, [name, fn]); return this.next; }
    disconnect(id) { this.signals.delete(id); }
    emit(name, ...args) {
        let result;
        for (const [signal, fn] of [...this.signals.values()])
            if (signal === name) result = fn(this, ...args);
        return result;
    }
}
class InjectionManager {
    constructor() { this.restore = []; }
    overrideMethod(object, name, create) {
        const old = object[name];
        object[name] = create(old);
        this.restore.push(() => object[name] = old);
    }
    clear() { this.restore.reverse().forEach(fn => fn()); }
}
class AppSystem { get_running() { return apps; } }
class Display extends Emitter { get_tab_list() { return windows; } }
class Workspace { _isOverviewWindow() { return true; } }
const globalMock = {display: new Display(), stage: new Emitter(),
    window_manager: new Emitter(), get_window_actors: () => []};
const APP = 'io.github.markymark5127.AIDesktop';
class MetaWindow extends Emitter { is_skip_taskbar() { return false; } }
function makeWindow(title, id = APP, transient = null) {
    return Object.assign(new MetaWindow(), {
        get_title: () => title, get_gtk_application_id: () => id,
        get_transient_for: () => transient, get_monitor: () => 0,
        get_frame_rect: () => ({x: 100, y: 100, width: 640, height: 100}),
        _actor: {contains: source => source === 'popover', opacity: 255,
            remove_all_transitions() {}, set_pivot_point() {}, set_scale() {},
            ease(props) { Object.assign(this, {opacity: props.opacity}); props.onStopped?.(); }},
        get_compositor_private() { return this._actor; },
        minimized: false, minimize() { this.minimized = true; },
        move_frame(...args) { this.position = args; },
    });
}
const search = makeWindow('Mutsu OS Search');
const wizard = makeWindow('Welcome to Mutsu OS');
const impostor = makeWindow('Mutsu OS Search', 'other.app');
const other = makeWindow('Files', 'org.gnome.Nautilus');
let windows = [search, wizard, other, impostor];
let apps = [
    {get_id: () => `${APP}.desktop`, get_windows: () => [search]},
    {get_id: () => 'org.gnome.Nautilus.desktop', get_windows: () => [other]},
];
let activated = null;
const keyboardBox = {get_parent: () => null};
const keyKey = {get_parent: () => keyboardBox};
const panelKeyboardButton = {accessible_name: 'Screen Keyboard', get_parent: () => null};
const overviewText = Object.assign(new Emitter(), {text: '', get_text() { return this.text; }});
const overviewEntry = {opacity: 255, reactive: true, clutter_text: overviewText,
    set_text(t) { overviewText.text = t; overviewText.emit('text-changed'); }};
let spawned = null, overviewHidden = 0;
const Main = {layoutManager: {getWorkAreaForMonitor: () => ({x: 0,y: 24,width: 1200,height: 900}), keyboardBox},
    overview: {hide() { overviewHidden++; }, searchEntry: overviewEntry},
    activateWindow(window) { activated = window; }};
const Clutter = {EventType: {BUTTON_PRESS: 1, TOUCH_BEGIN: 2}, EVENT_PROPAGATE: 0,
    AnimationMode: {EASE_OUT_QUAD: 0}};
const GLib = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, idle_add: (_p, fn) => fn(),
    spawn_async(_d, argv) { spawned = argv; },
    SpawnFlags: {SEARCH_PATH: 1}};
const {SearchIntegration, isSearchWindow, searchFadeMs} = new Function('InjectionManager','Workspace','Main',
    'Clutter','GLib','Meta','Shell','global', `${source}; return {SearchIntegration, isSearchWindow, searchFadeMs};`)(
    InjectionManager, Workspace, Main, Clutter, GLib, {Display, Window: MetaWindow}, {AppSystem}, globalMock);
const integration = new SearchIntegration();
assert.equal(search.is_skip_taskbar(), true, 'Search never listed in docks or as a minimized app');
assert.equal(other.is_skip_taskbar(), false);
assert.equal(impostor.is_skip_taskbar(), false);
assert(isSearchWindow(search));
assert(!isSearchWindow(wizard));
assert(!isSearchWindow(impostor));
assert.deepEqual(globalMock.display.get_tab_list(), [wizard, other, impostor]);
assert.equal(new AppSystem().get_running().length, 1, 'no running Search dock icon');
apps[0].get_windows = () => [search, wizard];
assert.equal(new AppSystem().get_running().length, 2, 'setup stays a normal app');
assert.equal(new Workspace()._isOverviewWindow(search), false);
assert.equal(new Workspace()._isOverviewWindow(wizard), true);
globalMock.window_manager.emit('map', {meta_window: search});
assert.equal(activated, search, 'search takes focus on map');
assert.deepEqual(search.position, [true, 280, 168]);
globalMock.display.focus_window = search;
function press(type, x, y, source) {
    return globalMock.stage.emit('captured-event', {type: () => type,
        get_coords: () => [x,y], get_source: () => source});
}
press(1, 110, 110, null);
assert.equal(search.minimized, false, 'inside click does not dismiss');
press(2, 600, 850, keyKey);
assert.equal(search.minimized, false, 'typing on the on-screen keyboard keeps Search open');
press(2, 1150, 10, panelKeyboardButton);
assert.equal(search.minimized, false, 'the keyboard button keeps Search open');
press(1, 900, 400, 'popover');
assert.equal(search.minimized, false, 'popover outside frame stays open');
assert.equal(press(2, 900, 400, null), 0, 'outside tap passes through');
assert(search.minimized, 'outside tap dismisses');
search.minimized = false;
globalMock.display.focus_window = makeWindow('Dialog', APP, search);
globalMock.display.emit('notify::focus-window');
assert.equal(search.minimized, false, 'own dialog remains usable');
globalMock.display.focus_window = other;
globalMock.display.emit('notify::focus-window');
assert(search.minimized, 'switching apps dismisses');
assert.equal(overviewEntry.opacity, 0, 'the overview search box is hidden');
overviewText.text = 'fire'; overviewText.emit('text-changed');
assert.deepEqual(spawned, ['/usr/bin/mutsu-search', '--query', 'fire'], 'typing in the overview opens Mutsu Search');
assert.equal(overviewText.text, '', 'overview search is cleared');
assert(overviewHidden > 0);
integration.destroy();
assert.equal(search.is_skip_taskbar(), false, 'restored on disable');
assert.equal(overviewEntry.opacity, 255, 'disable restores the overview search box');
assert.equal(overviewText.signals.size, 0);
assert.deepEqual(globalMock.display.get_tab_list(), windows, 'disable restores switcher');
assert.equal(globalMock.stage.signals.size, 0);
assert.equal(globalMock.display.signals.size, 0);
assert.equal(globalMock.window_manager.signals.size, 0);
assert.equal(search.signals.size, 0);
assert.equal(searchFadeMs(true, false), 0, 'desktop: Search just appears');
assert.equal(searchFadeMs(false, false), 0, 'desktop: and just disappears');
assert(searchFadeMs(true, true) > 0 && searchFadeMs(false, true) > 0, 'tablet: fades');
console.log('Search integration checks passed (fade only in tablet, identity, dock, switchers, focus, outside tap, keyboard, popover, dialog, overview redirect, cleanup).');
