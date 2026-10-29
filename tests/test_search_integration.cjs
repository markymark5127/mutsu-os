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
function makeWindow(title, id = APP, transient = null) {
    return Object.assign(new Emitter(), {
        get_title: () => title, get_gtk_application_id: () => id,
        get_transient_for: () => transient, get_monitor: () => 0,
        get_frame_rect: () => ({x: 100, y: 100, width: 640, height: 100}),
        get_compositor_private: () => ({contains: source => source === 'popover'}),
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
const Main = {layoutManager: {getWorkAreaForMonitor: () => ({x: 0,y: 24,width: 1200,height: 900})},
    overview: {hide() {}}, activateWindow(window) { activated = window; }};
const Clutter = {EventType: {BUTTON_PRESS: 1, TOUCH_BEGIN: 2}, EVENT_PROPAGATE: 0};
const {SearchIntegration, isSearchWindow} = new Function('InjectionManager','Workspace','Main',
    'Clutter','Meta','Shell','global', `${source}; return {SearchIntegration, isSearchWindow};`)(
    InjectionManager, Workspace, Main, Clutter, {Display}, {AppSystem}, globalMock);
const integration = new SearchIntegration();
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
integration.destroy();
assert.deepEqual(globalMock.display.get_tab_list(), windows, 'disable restores switcher');
assert.equal(globalMock.stage.signals.size, 0);
assert.equal(globalMock.display.signals.size, 0);
assert.equal(globalMock.window_manager.signals.size, 0);
assert.equal(search.signals.size, 0);
console.log('Search integration checks passed (identity, dock, switchers, focus, outside tap, popover, dialog, cleanup).');
