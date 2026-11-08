import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {homeMetrics, slotAt, pageSnap, pullDownAllowed, PULL_SEARCH_PX} from './tabletGeometry.js';
import {HomeLayout, itemId} from './homeLayout.js';
import {TouchRouter, makeTappable, findHandler} from './touchRouter.js';
import {TouchMenu} from './touchMenu.js';
import {vbox} from './stCompat.js';

const FOLDER_NAMES = {
    Game: 'Games', AudioVideo: 'Media', Audio: 'Music', Video: 'Video',
    Graphics: 'Creativity', Development: 'Developer', Office: 'Productivity',
    Network: 'Internet', Utility: 'Utilities', System: 'System', Settings: 'Settings',
    Education: 'Education', Science: 'Science',
};
const EDGE_FLIP_PX = 48;
const EDGE_FLIP_MS = 550;
const FOLDER_HOVER_MS = 380;

// Tablet Home. It lives in the background layer, *behind* every window, so
// any app that comes forward (from Home, the dock, Recent Apps, a
// notification or Alt-Tab) covers it automatically, and Home shows through
// whenever no app window is in the way. Wayland session only.
export class TabletHome {
    constructor({settings, monitor, search}) {
        this._settings = settings;
        this._getMonitor = monitor;
        this._search = search;
        this._signals = [];
        this._timers = new Set();
        this._page = 0;
        this._editing = false;
        this._drag = null;
        this._gesture = null;
        this._folder = null;
        this._pendingRender = false;
        this._apps = Shell.AppSystem.get_default();
        this._favorites = AppFavorites.getAppFavorites();
        this._savedLayout = settings.get_string('home-layout');
        this._layout = new HomeLayout(this._savedLayout);

        this._root = new St.Widget({style_class: 'mutsu-home', reactive: true,
            clip_to_allocation: true});
        this._root.connect('destroy', () => { this._root = null; });
        this._container = Main.layoutManager._backgroundGroup ?? global.window_group;
        this._container.add_child(this._root);
        this._raise();
        this._connect(this._container, 'child-added', (_c, child) => {
            if (child !== this._root)
                this._raise();
        });
        this._router = new TouchRouter(this._root, this);
        this._menu = new TouchMenu(this._root, this._router);

        this._connect(this._apps, 'installed-changed', () => this._appsChanged());
        this._connect(this._apps, 'app-state-changed', () => this._deferRender());
        this._connect(this._favorites, 'changed', () => this._deferRender());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._render());
        this._connect(Main.sessionMode, 'updated', () => this._syncVisible());
        this._connect(settings, 'changed::home-widgets', () => this._render());
        this._connect(settings, 'changed::home-layout', () => {
            if (settings.get_string('home-layout') === this._savedLayout)
                return;
            this._savedLayout = settings.get_string('home-layout');
            this._layout = new HomeLayout(this._savedLayout);
            this._appsChanged();
        });
        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._tickClock();
            return GLib.SOURCE_CONTINUE;
        });
        this._appsChanged();
        this._syncVisible();
    }

    get editing() { return this._editing; }

    _connect(object, signal, fn) {
        this._signals.push([object, object.connect(signal, fn)]);
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
        return id;
    }

    _cancelLater(id) {
        if (id && this._timers.delete(id))
            GLib.source_remove(id);
    }

    _raise() {
        // Above the wallpaper actors, below every window.
        try {
            this._container.set_child_above_sibling(this._root, null);
        } catch (e) {}
    }

    _syncVisible() {
        if (this._root)
            this._root.visible = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        if (Main.sessionMode.isLocked)
            this._closeTransient();
    }

    // ---- apps and layout -------------------------------------------------

    _installed() {
        const result = [];
        for (const info of this._apps.get_installed()) {
            try {
                if (!info.should_show())
                    continue;
                const app = this._apps.lookup_app(info.get_id());
                if (app)
                    result.push(app);
            } catch (e) {}
        }
        return result;
    }

    _app(id) {
        return this._apps.lookup_app(id);
    }

    _categories(app) {
        return (app.get_app_info?.()?.get_categories?.() || '').split(';').filter(Boolean);
    }

    _appsChanged() {
        if (this._drag || this._gesture || this._menu?.isOpen || this._folder) {
            this._pendingRender = true;
            return;
        }
        const installed = this._installed();
        const described = () => installed.map(app => ({id: app.get_id(), name: app.get_name(),
            categories: this._categories(app)}));
        if (this._layout.empty || this._layout.isLegacySeed(described())) {
            // First run, or a Home that was never rearranged since the old
            // alphabetical default: lay it out with the current default.
            this._layout = new HomeLayout();
            this._layout.seed(described());
            this._save();
        } else if (this._layout.sync(installed.map(app => app.get_id()))) {
            this._save();
        }
        this._render();
    }

    _save() {
        this._savedLayout = this._layout.serialize();
        this._settings.set_string('home-layout', this._savedLayout);
    }

    _folderName(a, b) {
        const shared = this._categories(a).filter(c => this._categories(b).includes(c));
        for (const category of shared) {
            if (FOLDER_NAMES[category])
                return FOLDER_NAMES[category];
        }
        return 'Folder';
    }

    // ---- rendering --------------------------------------------------------

    _deferRender() {
        if (this._drag || this._gesture || this._menu.isOpen || this._folder)
            this._pendingRender = true;
        else
            this._render();
    }

    _flushRender() {
        if (this._pendingRender && !this._drag && !this._gesture) {
            this._pendingRender = false;
            this._appsChanged();
        }
    }

    _render() {
        if (!this._root)
            return;
        this._menu.close();
        this._closeFolder(false);
        this._root.destroy_all_children();
        const monitor = this._getMonitor();
        if (!monitor)
            return;
        this._monitor = monitor;
        this._root.set_position(monitor.x, monitor.y);
        this._root.set_size(monitor.width, monitor.height);
        const widgets = this._settings.get_boolean('home-widgets');
        const m = homeMetrics(monitor.width, monitor.height, widgets);
        this._metrics = m;
        if (this._editing)
            this._root.add_style_class_name('mutsu-home-editing');
        else
            this._root.remove_style_class_name('mutsu-home-editing');

        this._renderHeader(m, widgets);

        const before = this._layout.serialize();
        this._pages = this._layout.pages(m.perPage);
        if (this._layout.serialize() !== before)
            this._save(); // rotation/smaller grid moved overflow to the next page
        if (this._editing && this._pages.at(-1).length)
            this._pages.push([]); // room to drop onto a new page
        this._page = Math.min(this._page, this._pages.length - 1);
        this._viewport = new St.Widget({clip_to_allocation: true, x: 0, y: m.gridY,
            width: monitor.width, height: m.gridH});
        this._strip = new St.Widget({x: 0, y: 0, width: monitor.width * this._pages.length,
            height: m.gridH});
        this._viewport.add_child(this._strip);
        this._root.add_child(this._viewport);
        this._tiles = new Map();
        this._pages.forEach((items, page) => {
            items.forEach((item, index) => {
                const tile = this._tile(item, m.icon);
                const pos = this._slotPosition(index, m);
                tile.set_position(page * monitor.width + pos.x, pos.y);
                this._strip.add_child(tile);
                this._tiles.set(itemId(item), {tile, page, index});
            });
        });
        this._strip.translation_x = -this._page * monitor.width;

        this._dots = new St.BoxLayout({style_class: 'mutsu-home-dots'});
        this._pages.forEach((_items, page) => {
            const dot = new St.Widget({style_class: page === this._page
                ? 'mutsu-home-dot mutsu-home-dot-active' : 'mutsu-home-dot'});
            makeTappable(dot, () => this._goToPage(page), `Page ${page + 1}`);
            this._dots.add_child(dot);
        });
        this._root.add_child(this._dots);
        this._centre(this._dots, m.dotsY);
        this._dots.visible = this._pages.length > 1;

        this._renderDock(m);

        this._pull = new St.BoxLayout({style_class: 'mutsu-home-pull', opacity: 0});
        this._pull.add_child(new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 18}));
        this._pull.add_child(new St.Label({text: 'Release for Search',
            y_align: Clutter.ActorAlign.CENTER}));
        this._root.add_child(this._pull);
        this._centre(this._pull, m.headerY);

        this._dragLayer = new St.Widget({x: 0, y: 0, width: monitor.width,
            height: monitor.height});
        this._root.add_child(this._dragLayer);
        this._wiggle(this._editing);
    }

    _centre(actor, y) {
        const [, width] = actor.get_preferred_width(-1);
        actor.set_position(Math.round((this._monitor.width - width) / 2), Math.round(y));
    }

    _slotPosition(index, m) {
        const col = index % m.cols;
        const row = Math.floor(index / m.cols);
        const tileW = m.icon + 40;
        return {x: Math.round(m.gridX + col * m.cellW + (m.cellW - tileW) / 2),
            y: Math.round(row * m.cellH + 6)};
    }

    _renderHeader(m, widgets) {
        const header = new St.BoxLayout({style_class: 'mutsu-home-header',
            x: m.gridX, y: m.headerY, width: this._monitor.width - m.gridX * 2});
        if (widgets) {
            const clock = vbox({style_class: 'mutsu-home-clock-widget'});
            this._time = new St.Label({style_class: 'mutsu-home-time'});
            this._date = new St.Label({style_class: 'mutsu-home-date'});
            clock.add_child(this._time);
            clock.add_child(this._date);
            header.add_child(clock);
            this._tickClock();
        } else {
            this._time = this._date = null;
        }
        header.add_child(new St.Widget({x_expand: true}));
        const search = new St.BoxLayout({style_class: 'mutsu-home-search',
            y_align: Clutter.ActorAlign.CENTER});
        search.add_child(new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 16}));
        search.add_child(new St.Label({text: 'Search', y_align: Clutter.ActorAlign.CENTER}));
        makeTappable(search, () => this._search(), 'Search. Or pull down on Home');
        header.add_child(search);
        header.add_child(new St.Widget({x_expand: true}));
        if (this._editing) {
            const done = new St.Label({text: 'Done', style_class: 'mutsu-home-done',
                y_align: Clutter.ActorAlign.CENTER});
            makeTappable(done, () => this.setEditing(false), 'Done editing Home Screen');
            header.add_child(done);
        } else if (widgets) {
            // Balance the clock so Search stays centred.
            header.add_child(new St.Widget({style_class: 'mutsu-home-clock-widget', opacity: 0}));
        }
        this._root.add_child(header);
    }

    _tickClock() {
        if (!this._time)
            return;
        let format = '24h';
        try {
            format = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
                .get_string('clock-format');
        } catch (e) {}
        const now = GLib.DateTime.new_now_local();
        this._time.text = now.format(format === '12h' ? '%l:%M' : '%H:%M').trim();
        this._date.text = now.format('%A, %B %-d');
    }

    _icon(app, size) {
        return app.create_icon_texture(size);
    }

    _tile(item, size) {
        const tile = vbox({style_class: 'mutsu-home-tile',
            width: size + 40});
        const art = new St.Widget({style_class: 'mutsu-home-art', width: size, height: size,
            x_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout()});
        tile.add_child(art);
        let name;
        if (typeof item === 'string') {
            const app = this._app(item);
            name = app?.get_name() ?? item;
            if (app)
                art.add_child(this._icon(app, size));
            tile.add_child(new St.Label({text: name, style_class: 'mutsu-home-label'}));
            const dot = new St.Widget({style_class: 'mutsu-running-dot',
                x_align: Clutter.ActorAlign.CENTER});
            dot.opacity = app?.state === Shell.AppState.RUNNING ? 255 : 0;
            tile.add_child(dot);
            makeTappable(tile, () => this._activate(item), name);
        } else {
            name = item.name;
            art.add_style_class_name('mutsu-home-folder-art');
            const grid = new St.Widget({layout_manager: new Clutter.GridLayout(),
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            const mini = Math.round(size * 0.32);
            item.apps.slice(0, 4).forEach((id, i) => {
                const app = this._app(id);
                if (app)
                    grid.layout_manager.attach(this._icon(app, mini), i % 2, Math.floor(i / 2), 1, 1);
            });
            art.add_child(grid);
            tile.add_child(new St.Label({text: name, style_class: 'mutsu-home-label'}));
            tile.add_child(new St.Widget({style_class: 'mutsu-running-dot', opacity: 0}));
            makeTappable(tile, () => this._openFolder(itemId(item)), `Folder ${name}`);
        }
        tile._mutsuItem = itemId(item);
        tile._mutsuLongPress = state => this._tileHeld(tile, state);
        return tile;
    }

    _renderDock(m) {
        const dock = new St.BoxLayout({style_class: 'mutsu-home-dock'});
        const favorites = this._favorites.getFavorites();
        const favoriteIds = new Set(favorites.map(app => app.get_id()));
        const recents = this._apps.get_running()
            .filter(app => !favoriteIds.has(app.get_id())).slice(0, 3);
        const limit = Math.max(4, m.cols + 2 - recents.length);
        const add = app => {
            const button = new St.Widget({style_class: 'mutsu-home-dock-app',
                layout_manager: new Clutter.BinLayout()});
            const column = vbox({});
            column.add_child(this._icon(app, m.dockIcon));
            const dot = new St.Widget({style_class: 'mutsu-running-dot',
                x_align: Clutter.ActorAlign.CENTER});
            dot.opacity = app.state === Shell.AppState.RUNNING ? 255 : 0;
            column.add_child(dot);
            button.add_child(column);
            makeTappable(button, () => this._launch(app), app.get_name());
            button._mutsuDockApp = app.get_id();
            button._mutsuLongPress = state => {
                if (this._editing) {
                    this._startDrag(button, state, {id: app.get_id(), fromDock: true});
                    return true;
                }
                this._appMenu(app, button);
                this._heldDock = app.get_id(); // moving the finger picks it up
                return true;
            };
            dock.add_child(button);
        };
        favorites.slice(0, limit).forEach(add);
        if (recents.length) {
            dock.add_child(new St.Widget({style_class: 'mutsu-home-dock-divider'}));
            recents.forEach(add);
        }
        this._root.add_child(dock);
        this._centre(dock, m.dockY);
        this._dock = dock;
    }

    // ---- activation and menus ----------------------------------------------

    _activate(id) {
        if (this._editing)
            return;
        const app = this._app(id);
        if (app)
            this._launch(app);
    }

    _launch(app) {
        this._menu.close();
        this._closeFolder();
        const window = app.get_windows().find(w => !w.is_skip_taskbar());
        if (window)
            Main.activateWindow(window);
        else
            app.activate();
    }

    _anchor(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return {x, y, width, height};
    }

    _appMenu(app, actor, extra = []) {
        const isFavorite = this._favorites.isFavorite(app.get_id());
        const running = app.state === Shell.AppState.RUNNING;
        const items = [{label: running ? 'Show' : 'Open', action: () => this._launch(app)}];
        if (running && app.can_open_new_window?.())
            items.push({label: 'New Window', action: () => app.open_new_window(-1)});
        items.push(isFavorite
            ? {label: 'Remove from Dock', action: () => this._favorites.removeFavorite(app.get_id())}
            : {label: 'Add to Dock', action: () => this._favorites.addFavorite(app.get_id())});
        items.push(...extra);
        if (!this._editing)
            items.push({label: 'Edit Home Screen', action: () => this.setEditing(true)});
        if (running)
            items.push({label: 'Quit', destructive: true, action: () => app.request_quit()});
        this._menu.open(items, this._anchor(actor), this._monitor);
    }

    _tileHeld(tile, state) {
        if (this._editing) {
            this._startDrag(tile, state);
            return true;
        }
        const id = tile._mutsuItem;
        if (id.startsWith('folder:')) {
            this._menu.open([
                {label: 'Rename', action: () => this._openFolder(id, true)},
                {label: 'Edit Home Screen', action: () => this.setEditing(true)},
            ], this._anchor(tile), this._monitor);
        } else {
            const app = this._app(id);
            if (!app)
                return false;
            this._appMenu(app, tile);
        }
        this._heldTile = tile;
        return true; // keep tracking: moving the finger picks the icon up
    }

    setEditing(editing) {
        if (this._editing === editing)
            return;
        this._editing = editing;
        this._render();
    }

    _wiggle(on) {
        for (const {tile, index} of this._tiles?.values() ?? []) {
            tile.remove_all_transitions();
            tile.rotation_angle_z = 0;
            if (!on)
                continue;
            tile.set_pivot_point(0.5, 0.4);
            tile.rotation_angle_z = index % 2 ? -1.6 : 1.6;
            tile.ease({rotation_angle_z: index % 2 ? 1.6 : -1.6, duration: 130 + (index % 3) * 10,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true});
        }
    }

    // ---- folders --------------------------------------------------------------

    _openFolder(id, rename = false) {
        const folder = this._layout.folder(id);
        if (!folder)
            return;
        this._menu.close();
        this._closeFolder(false);
        const m = this._metrics;
        const backdrop = new St.Widget({style_class: 'mutsu-home-folder-backdrop', reactive: true,
            x: 0, y: 0, width: this._monitor.width, height: this._monitor.height});
        const cols = Math.min(4, Math.max(3, Math.ceil(Math.sqrt(folder.apps.length))));
        const tileW = m.icon + 40;
        const panelW = cols * (tileW + 16) + 48;
        const panel = vbox({style_class: 'mutsu-home-folder',
            width: panelW});
        const title = new St.Entry({text: folder.name, style_class: 'mutsu-home-folder-title',
            can_focus: true, x_align: Clutter.ActorAlign.CENTER});
        title._mutsuPassthrough = true;
        title.clutter_text.connect('activate', () => this._closeFolder());
        panel.add_child(title);
        const grid = new St.Widget({layout_manager: new Clutter.GridLayout({
            column_spacing: 16, row_spacing: 12})});
        folder.apps.forEach((appId, i) => {
            const app = this._app(appId);
            if (!app)
                return;
            const tile = vbox({style_class: 'mutsu-home-tile',
                width: tileW});
            const art = new St.Widget({width: m.icon, height: m.icon,
                x_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout()});
            art.add_child(this._icon(app, m.icon));
            tile.add_child(art);
            tile.add_child(new St.Label({text: app.get_name(), style_class: 'mutsu-home-label'}));
            makeTappable(tile, () => this._launch(app), app.get_name());
            tile._mutsuLongPress = () => {
                this._appMenu(app, tile, [{label: 'Remove from Folder', action: () => {
                    this._layout.removeFromFolder(id, appId);
                    this._save();
                    this._render();
                }}]);
                // Moving the finger drags the app out of the folder.
                this._heldFolderApp = {folderId: id, appId};
                return true;
            };
            grid.layout_manager.attach(tile, i % cols, Math.floor(i / cols), 1, 1);
        });
        panel.add_child(grid);
        backdrop.add_child(panel);
        this._root.add_child(backdrop);
        const [, height] = panel.get_preferred_height(panelW);
        panel.set_position(Math.round((this._monitor.width - panelW) / 2),
            Math.round(Math.max(60, (this._monitor.height - height) / 2 - 20)));
        backdrop.opacity = 0;
        panel.set_pivot_point(0.5, 0.5);
        panel.scale_x = panel.scale_y = 0.85;
        backdrop.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        panel.ease({scale_x: 1, scale_y: 1, duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_BACK});
        this._folder = {id, backdrop, title};
        this._router.modal = panel;
        this._router.onOutsideModal = () => this._closeFolder();
        if (rename) {
            title.grab_key_focus();
            title.clutter_text.set_selection(0, -1);
        }
    }

    _closeFolder(refresh = true) {
        const folder = this._folder;
        if (!folder)
            return;
        this._folder = null;
        this._router.modal = null;
        this._router.onOutsideModal = null;
        if (this._layout.renameFolder(folder.id, folder.title.get_text()))
            this._save();
        folder.backdrop.destroy();
        if (!refresh)
            return;
        // Refresh the folder tile's name and icons outside this event.
        this._later(0, () => {
            this._pendingRender = false;
            this._appsChanged();
        });
    }

    _closeTransient() {
        this._menu.close();
        this._closeFolder();
        this._router.cancel();
        this._endDrag(false);
        this._gesture = null;
    }

    // ---- paging and pull-down search --------------------------------------

    _goToPage(page) {
        this._page = Math.max(0, Math.min(this._pages.length - 1, page));
        this._strip?.ease({translation_x: -this._page * this._monitor.width, duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._dots?.get_children().forEach((dot, i) => {
            if (i === this._page)
                dot.add_style_class_name('mutsu-home-dot-active');
            else
                dot.remove_style_class_name('mutsu-home-dot-active');
        });
    }

    // Router delegate ---------------------------------------------------------

    dragStart(kind, s) {
        if (this._menu.isOpen || this._folder)
            return false;
        if (this._editing) {
            const tile = findHandler(s.source, this._root, '_mutsuLongPress');
            if (tile?._mutsuItem || tile?._mutsuDockApp) {
                if (tile._mutsuItem)
                    this._startDrag(tile, s);
                else
                    this._startDrag(tile, s, {id: tile._mutsuDockApp, fromDock: true});
                this._gesture = 'icon';
                return true;
            }
        }
        if (kind === 'horizontal') {
            this._gesture = 'page';
            this._strip?.remove_all_transitions();
            return true;
        }
        if (kind === 'down' && !this._editing && pullDownAllowed(s.startX, s.startY, this._monitor)) {
            this._gesture = 'pull';
            return true;
        }
        return false;
    }

    drag(_kind, dx, dy, s) {
        if (this._gesture === 'page') {
            const last = this._pages.length - 1;
            let offset = dx;
            if ((this._page === 0 && dx > 0) || (this._page === last && dx < 0))
                offset = dx * 0.3; // rubber band at the ends
            this._strip.translation_x = -this._page * this._monitor.width + offset;
        } else if (this._gesture === 'pull') {
            const progress = Math.min(1, Math.max(0, dy / PULL_SEARCH_PX));
            this._viewport.translation_y = Math.min(dy, 140) * 0.35;
            this._pull.opacity = Math.round(255 * progress);
            this._pull.translation_y = Math.min(dy, 140) * 0.25;
        } else if (this._gesture === 'icon') {
            this._moveDrag(s);
        }
    }

    dragEnd(_kind, dx, dy, velocity, s) {
        const gesture = this._gesture;
        this._gesture = null;
        if (gesture === 'page') {
            this._goToPage(pageSnap(this._page, dx, velocity, this._monitor.width, this._pages.length));
        } else if (gesture === 'pull') {
            this._viewport.ease({translation_y: 0, duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._pull.ease({opacity: 0, translation_y: 0, duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            if (dy >= PULL_SEARCH_PX)
                this._search();
        } else if (gesture === 'icon') {
            this._moveDrag(s);
            this._endDrag(true);
        }
        this._flushRender();
    }

    longPress(s) {
        if (this._folder || this._menu.isOpen)
            return undefined; // let the folder's own tiles handle it
        const tile = findHandler(s.source, this._root, '_mutsuLongPress');
        if (tile)
            return undefined; // tile/dock handlers
        if (!this._editing)
            this.setEditing(true); // long-press on the wallpaper: jiggle mode
        return false;
    }

    heldMove(dx, dy, s) {
        if (this._drag) {
            this._moveDrag(s);
            return;
        }
        if (Math.hypot(dx, dy) > 12 && this._heldFolderApp) {
            const {folderId, appId} = this._heldFolderApp;
            this._heldFolderApp = null;
            this._menu.close();
            if (this._layout.removeFromFolder(folderId, appId))
                this._save();
            this._editing = true;
            this._render();
            const tile = this._tiles.get(appId)?.tile;
            if (tile)
                this._startDrag(tile, s);
            return;
        }
        if (Math.hypot(dx, dy) > 12 && this._heldDock) {
            const id = this._heldDock;
            this._heldDock = null;
            this._menu.close();
            this._editing = true;
            this._render();
            const button = this._dock.get_children().find(b => b._mutsuDockApp === id);
            if (button)
                this._startDrag(button, s, {id, fromDock: true});
            return;
        }
        if (this._heldTile && Math.hypot(dx, dy) > 12) {
            const id = this._heldTile._mutsuItem;
            this._heldTile = null;
            this._menu.close();
            this._editing = true;
            this._render();
            const tile = this._tiles.get(id)?.tile;
            if (tile)
                this._startDrag(tile, s);
        }
    }

    heldEnd(s) {
        this._heldTile = null;
        this._heldDock = null;
        this._heldFolderApp = null;
        if (this._drag) {
            this._moveDrag(s);
            this._endDrag(true);
        }
        this._flushRender();
    }

    tap(s) {
        if (this._editing && !findHandler(s.source, this._root, '_mutsuTap')) {
            this.setEditing(false);
            return true;
        }
        return false;
    }

    cancel() {
        this._heldTile = null;
        this._heldDock = null;
        this._heldFolderApp = null;
        if (this._gesture === 'page')
            this._goToPage(this._page);
        if (this._gesture === 'pull') {
            this._viewport.translation_y = 0;
            this._pull.opacity = 0;
        }
        this._gesture = null;
        this._endDrag(false);
        this._flushRender();
    }

    // ---- dragging icons in edit mode ----------------------------------------

    _startDrag(actor, s, {id = actor._mutsuItem, fromDock = false} = {}) {
        if (this._drag || !id)
            return;
        const info = this._tiles.get(id);
        if (!fromDock && !info)
            return;
        const [tx, ty] = actor.get_transformed_position();
        const clone = new Clutter.Clone({source: actor, opacity: 230});
        clone.set_size(...actor.get_size());
        this._dragLayer.add_child(clone);
        clone.set_position(tx - this._monitor.x, ty - this._monitor.y);
        clone.set_pivot_point(0.5, 0.5);
        clone.ease({scale_x: 1.15, scale_y: 1.15, duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._drag = {id, actor, clone, fromDock, offsetX: s.x - tx, offsetY: s.y - ty,
            target: info ? {page: info.page, index: info.index} : null,
            dock: fromDock ? this._dockIndex(s.x) : null,
            onto: null, flipTimer: 0, ontoTimer: 0};
        actor.opacity = 0;
    }

    // Is the finger over the Home dock? Returns the favourites slot or null.
    _dockIndex(x, y = null) {
        const dock = this._dock;
        if (!dock)
            return null;
        const [dx, dy] = dock.get_transformed_position();
        const [dw, dh] = dock.get_transformed_size();
        if (y !== null && (y < dy - 24 || y > dy + dh + 24 || x < dx - 24 || x > dx + dw + 24))
            return null;
        let index = 0;
        for (const child of dock.get_children()) {
            if (!child._mutsuDockApp || !this._favorites.isFavorite(child._mutsuDockApp))
                continue;
            const [cx] = child.get_transformed_position();
            const [cw] = child.get_transformed_size();
            if (x > cx + cw / 2 && child._mutsuDockApp !== this._drag?.id)
                index++;
        }
        return index;
    }

    _moveDrag(s) {
        const d = this._drag;
        if (!d)
            return;
        const m = this._metrics;
        const x = s.x - this._monitor.x;
        const y = s.y - this._monitor.y;
        d.clone.set_position(x - d.offsetX, y - d.offsetY);

        // Over the dock: apps only (folders cannot go in the dock).
        const dockSlot = d.id.startsWith('folder:') ? null : this._dockIndex(s.x, s.y);
        if (dockSlot !== null) {
            d.dock = dockSlot;
            this._dock.add_style_class_name('mutsu-home-dock-drop');
            this._clearFolderIntent(d);
            return;
        }
        d.dock = null;
        this._dock?.remove_style_class_name('mutsu-home-dock-drop');

        // Hold at a screen edge to move to the neighbouring page.
        const edge = x < EDGE_FLIP_PX ? -1 : x > this._monitor.width - EDGE_FLIP_PX ? 1 : 0;
        if (edge && !d.flipTimer) {
            d.flipTimer = this._later(EDGE_FLIP_MS, () => {
                d.flipTimer = 0;
                if (this._drag !== d)
                    return;
                const next = this._page + edge;
                if (next >= 0 && next <= this._pages.length) {
                    if (next === this._pages.length)
                        this._pages.push([]);
                    this._goToPage(next);
                    d.target = null;
                    this._previewReorder();
                }
            });
        } else if (!edge && d.flipTimer) {
            this._cancelLater(d.flipTimer);
            d.flipTimer = 0;
        }

        const page = this._pages[this._page] ?? [];
        const slot = slotAt(x, y, m);
        // What is *shown* in that slot: once icons have slid aside for the
        // drag, the stored order no longer matches the screen, and stacking
        // onto the icon under your finger picked a different (hidden) one.
        const shown = this._shownOrder(page);
        const underId = shown[slot.index] ?? null;
        const canFolder = slot.onto && underId && underId !== d.id && !d.id.startsWith('folder:');
        if (canFolder) {
            if (d.onto !== underId) {
                this._clearFolderIntent(d);
                d.onto = underId;
                d.ontoTimer = this._later(FOLDER_HOVER_MS, () => {
                    d.ontoTimer = 0;
                    if (this._drag === d && d.onto === underId)
                        this._setDropTarget(underId);
                });
            }
            return;
        }
        this._clearFolderIntent(d);
        // Items flow from the top-left: past the last icon means "at the end".
        const others = page.filter(item => itemId(item) !== d.id).length;
        const index = Math.min(slot.index, others);
        if (!d.target || d.target.page !== this._page || d.target.index !== index) {
            d.target = {page: this._page, index};
            this._previewReorder();
        }
    }

    // The current page as it looks during a drag (the dragged item sits at
    // its preview position, or nowhere if it came from another page).
    _shownOrder(page) {
        const d = this._drag;
        const ids = page.map(itemId).filter(id => id !== d.id);
        if (d.target && d.target.page === this._page)
            ids.splice(Math.max(0, Math.min(ids.length, d.target.index)), 0, d.id);
        return ids;
    }

    _clearFolderIntent(d) {
        if (!d.onto)
            return;
        this._cancelLater(d.ontoTimer);
        d.ontoTimer = 0;
        d.onto = null;
        this._setDropTarget(null);
    }

    _setDropTarget(id) {
        for (const [key, {tile}] of this._tiles) {
            if (key === id)
                tile.add_style_class_name('mutsu-home-drop-target');
            else
                tile.remove_style_class_name('mutsu-home-drop-target');
        }
        if (this._drag)
            this._drag.folderReady = id;
    }

    // Slide the icons on the current page into the order a drop would give.
    _previewReorder() {
        const d = this._drag;
        const m = this._metrics;
        const page = (this._pages[this._page] ?? []).map(itemId).filter(id => id !== d.id);
        if (d.target && d.target.page === this._page)
            page.splice(Math.max(0, Math.min(page.length, d.target.index)), 0, d.id);
        page.forEach((id, i) => {
            const info = this._tiles.get(id);
            if (!info || id === d.id)
                return;
            const pos = this._slotPosition(i, m);
            const visible = i < m.perPage; // pushed to the next page on drop
            info.tile.ease({x: this._page * this._monitor.width + pos.x, y: pos.y,
                opacity: visible ? 255 : 0, duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        });
    }

    _endDrag(commit) {
        const d = this._drag;
        if (!d)
            return;
        this._drag = null;
        this._cancelLater(d.flipTimer);
        this._cancelLater(d.ontoTimer);
        let changed = false;
        if (commit) {
            if (d.dock !== null) {
                // Into (or around) the dock. The app stays on the grid too.
                if (this._favorites.isFavorite(d.id))
                    this._favorites.moveFavoriteToPos(d.id, d.dock);
                else
                    this._favorites.addFavoriteAtPos(d.id, d.dock);
            } else if (d.fromDock) {
                // Dragged off the dock onto the grid: remove it from the dock.
                this._favorites.removeFavorite(d.id);
            } else if (d.folderReady && d.folderReady === d.onto) {
                const a = this._app(d.id);
                const targetId = d.folderReady;
                const b = targetId.startsWith('folder:') ? null : this._app(targetId);
                changed = this._layout.dropOnto(d.id, targetId,
                    a && b ? this._folderName(a, b) : 'Folder');
            } else if (d.target) {
                changed = this._layout.move(d.id, d.target.page, d.target.index);
            }
        }
        d.clone.destroy();
        if (changed)
            this._save();
        this._render();
    }

    // ---- public ---------------------------------------------------------------

    // Little zoom when arriving Home, matching the app shrinking away.
    reveal() {
        if (!this._viewport)
            return;
        for (const actor of [this._viewport, this._dock]) {
            actor.set_pivot_point(0.5, 0.5);
            actor.scale_x = actor.scale_y = 1.06;
            actor.opacity = 0;
            actor.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 260,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    relayout() {
        this._render();
    }

    destroy() {
        this._closeTransient();
        this._router.destroy();
        GLib.source_remove(this._clockId);
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._root?.destroy();
        this._root = null;
    }
}
