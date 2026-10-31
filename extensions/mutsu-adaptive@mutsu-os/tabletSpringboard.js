import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

const ICON = 76;
const PER_PAGE = 20;

// A real Home: paged app icons, a search field, a dock, and an App Library page.
export class TabletSpringboard {
    constructor(onLaunch) {
        this._onLaunch = onLaunch;
        this._page = 0;
        this._query = '';
        this._root = null;
        this._drag = null;
        this._eventId = 0;
    }

    get visible() { return this._root !== null; }

    show() {
        this.hide();
        if (Main.sessionMode.isLocked)
            return;
        try { Main.overview.hide(); } catch (e) {}
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const root = new St.Widget({
            style_class: 'mutsu-springboard',
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
        });
        root.set_position(monitor.x, monitor.y);
        root.set_size(monitor.width, monitor.height);
        Main.layoutManager.uiGroup.add_child(root);
        this._root = root;
        this._monitor = monitor;

        const column = new St.BoxLayout({vertical: true, style_class: 'mutsu-springboard-column'});
        root.add_child(column);

        this._search = new St.Entry({
            hint_text: 'Search',
            style_class: 'mutsu-springboard-search',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._search.clutter_text.connect('text-changed', () => {
            this._query = this._search.get_text();
            this._page = 0;
            this._render();
        });
        column.add_child(this._search);

        this._pages = new St.Widget({style_class: 'mutsu-springboard-pages', x_expand: true, y_expand: true});
        column.add_child(this._pages);
        this._dots = new St.BoxLayout({style_class: 'mutsu-springboard-dots',
            x_align: Clutter.ActorAlign.CENTER});
        column.add_child(this._dots);
        this._dock = new St.BoxLayout({style_class: 'mutsu-touch-dock mutsu-springboard-dock',
            x_align: Clutter.ActorAlign.CENTER});
        column.add_child(this._dock);

        this._render();
        this._eventId = root.connect('event', (_a, event) => this._event(event));
    }

    hide() {
        if (this._eventId && this._root)
            this._root.disconnect(this._eventId);
        this._eventId = 0;
        this._root?.destroy();
        this._root = null;
    }

    _apps() {
        const query = this._query.trim().toLowerCase();
        const apps = Shell.AppSystem.get_default().get_installed()
            .filter(app => app.get_app_info?.()?.should_show?.() !== false);
        if (!query)
            return apps;
        return apps.filter(app => app.get_name().toLowerCase().includes(query));
    }

    _render() {
        if (!this._pages)
            return;
        this._pages.destroy_all_children();
        this._dots.destroy_all_children();
        this._dock.destroy_all_children();
        const apps = this._apps();
        const library = !this._query;
        const pageCount = Math.max(1, Math.ceil(apps.length / PER_PAGE)) + (library ? 1 : 0);
        this._page = Math.min(this._page, pageCount - 1);
        const onLibrary = library && this._page === pageCount - 1;
        if (onLibrary)
            this._renderLibrary();
        else
            this._renderPage(apps.slice(this._page * PER_PAGE, (this._page + 1) * PER_PAGE));
        for (let i = 0; i < pageCount; i++) {
            const dot = new St.Widget({style_class: i === this._page
                ? 'mutsu-springboard-dot mutsu-springboard-dot-active'
                : 'mutsu-springboard-dot'});
            this._dots.add_child(dot);
        }
        const favorites = AppFavorites.getAppFavorites().getFavorites();
        for (const app of favorites.slice(0, 6))
            this._dock.add_child(this._icon(app, 52));
    }

    _renderPage(apps) {
        const grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({orientation: Clutter.Orientation.HORIZONTAL}),
            style_class: 'mutsu-springboard-grid',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const layout = grid.layout_manager;
        apps.forEach((app, index) => {
            layout.attach(this._icon(app, ICON), index % 5, Math.floor(index / 5), 1, 1);
        });
        this._pages.add_child(grid);
    }

    _renderLibrary() {
        const box = new St.BoxLayout({vertical: true, style_class: 'mutsu-app-library',
            x_expand: true, y_expand: true});
        box.add_child(new St.Label({text: 'App Library', style_class: 'mutsu-switcher-title'}));
        const groups = new Map();
        for (const app of this._apps()) {
            const cats = (app.get_app_info?.()?.get_categories?.() || 'Other').split(';').filter(Boolean);
            const group = cats[0] || 'Other';
            if (!groups.has(group))
                groups.set(group, []);
            groups.get(group).push(app);
        }
        const scroll = new St.ScrollView({x_expand: true, y_expand: true});
        const list = new St.BoxLayout({vertical: true, style_class: 'mutsu-library-group'});
        scroll.set_child(list);
        for (const [group, items] of [...groups.entries()].sort()) {
            list.add_child(new St.Label({text: group, style_class: 'mutsu-switcher-hint'}));
            const row = new St.BoxLayout({style_class: 'mutsu-library-group'});
            for (const app of items.slice(0, 8))
                row.add_child(this._icon(app, 48));
            list.add_child(row);
        }
        box.add_child(scroll);
        this._pages.add_child(box);
    }

    _icon(app, size) {
        const box = new St.BoxLayout({vertical: true, style_class: 'mutsu-springboard-icon'});
        const button = new St.Button({
            style_class: 'mutsu-springboard-button',
            accessible_name: app.get_name(),
            child: app.create_icon_texture(size),
        });
        button.connect('clicked', () => this._launch(app));
        box.add_child(button);
        box.add_child(new St.Label({text: app.get_name(), style_class: 'mutsu-springboard-label'}));
        return box;
    }

    _launch(app) {
        this.hide();
        this._onLaunch?.();
        const window = app.get_windows().find(w => !w.is_skip_taskbar());
        if (window)
            Main.activateWindow(window);
        else
            app.activate();
    }

    _event(event) {
        const type = event.type();
        const begin = type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.BUTTON_PRESS;
        const end = type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE;
        if (begin) {
            this._drag = event.get_coords()[0];
            return Clutter.EVENT_PROPAGATE;
        }
        if (!end || this._drag == null)
            return Clutter.EVENT_PROPAGATE;
        const dx = event.get_coords()[0] - this._drag;
        this._drag = null;
        if (Math.abs(dx) < 60)
            return Clutter.EVENT_PROPAGATE;
        this._page += dx < 0 ? 1 : -1;
        this._page = Math.max(0, this._page);
        this._render();
        return Clutter.EVENT_STOP;
    }

    destroy() { this.hide(); }
}
