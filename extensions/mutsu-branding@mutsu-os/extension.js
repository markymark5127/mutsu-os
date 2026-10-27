/*
 * Mutsu OS GNOME Shell branding.
 * Top-left Mutsu logo with a Mac-style menu. Hides Activities while enabled.
 */
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

const BASE = '/usr/share/mutsu-os/branding/shell';
const JAPANDI_SYMBOL = '/usr/share/mutsu-os/branding/icons/mutsu-logo-japandi.svg';
const DARK_SYMBOL = '/usr/share/mutsu-os/branding/icons/mutsu-logo-symbolic-white.svg';

export default class MutsuBrandingExtension extends Extension {
    enable() {
        this._activeStylesheet = null;
        this._settings = this.getSettings();
        this._activitiesWasVisible = null;

        try {
            const activities = Main.panel.statusArea.activities;
            if (activities) {
                this._activitiesWasVisible = activities.visible;
                activities.hide();
            }
        } catch (e) {
            log(`Mutsu branding: could not hide Activities (${e})`);
        }

        this._indicator = new PanelMenu.Button(0.0, 'Mutsu OS', false);
        this._logoIcon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 22,
        });
        this._indicator.add_child(this._logoIcon);

        const menu = this._indicator.menu;
        menu.addAction('About Mutsu OS', () => this._launch(['gnome-control-center', 'info-overview']));
        menu.addAction('Mutsu Search', () => this._launch(['/usr/bin/mutsu-search']));
        menu.addAction('Setup Wizard…', () => this._launch(['/usr/bin/mutsu-search', '--setup']));
        menu.addAction('System Settings…', () => this._launch(['gnome-control-center']));
        menu.addAction('Files', () => this._launch(['nautilus']));
        menu.addAction('Show Applications', () => {
            try {
                Main.overview.showApps();
            } catch (e) {}
        });
        menu.addAction('Calm Japandi', () => this._settings.set_string('appearance', 'japandi'));
        menu.addAction('Cyberpunk', () => this._settings.set_string('appearance', 'cyberpunk'));
        menu.addAction('Follow System', () => this._settings.set_string('appearance', 'system'));

        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'left');

        this._changedId = this._settings.connect('changed::appearance', () => this._applyAppearance());
        this._applyAppearance();
    }

    _launch(argv) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn('Mutsu branding: launch failed', argv, e);
        }
    }

    _applyAppearance() {
        this._unloadStyle();
        const name = this._settings.get_string('appearance');
        const isCyber = name === 'cyberpunk';
        const isJapandi = name === 'japandi';

        // Logo
        const iconPath = isJapandi ? JAPANDI_SYMBOL : DARK_SYMBOL;
        this._logoIcon.gicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(iconPath),
        });

        if (!isJapandi && !isCyber)
            return;

        // Shell stylesheet
        const file = Gio.File.new_for_path(`${BASE}/${name}.css`);
        try {
            if (file.query_exists(null)) {
                const shellTheme = St.ThemeContext.get_for_stage(global.stage).get_theme();
                shellTheme.load_stylesheet(file);
                this._activeStylesheet = file;
            }
        } catch (error) {
            console.warn('Mutsu branding: could not load theme', error);
        }

        // Full desktop switch: color scheme, wallpaper, accent, GTK CSS
        this._applyDesktopTheme(isCyber);
    }

    _applyDesktopTheme(isCyber) {
        try {
            const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            iface.set_string('color-scheme', isCyber ? 'prefer-dark' : 'prefer-light');
            iface.set_string('accent-color', isCyber ? 'blue' : 'green');
        } catch (e) {
            log(`Mutsu branding: interface settings failed (${e})`);
        }
        try {
            const wm = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
            wm.set_string('button-layout', 'close,minimize,maximize:');
        } catch (e) {}
        try {
            const bg = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
            const uri = isCyber
                ? 'file:///usr/share/backgrounds/mutsu/mutsu-cyberpunk-4k.png'
                : 'file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png';
            bg.set_string('picture-uri', uri);
            bg.set_string('picture-uri-dark', uri);
        } catch (e) {}
        try {
            const ss = new Gio.Settings({ schema_id: 'org.gnome.desktop.screensaver' });
            const uri = isCyber
                ? 'file:///usr/share/backgrounds/mutsu/mutsu-cyberpunk-4k.png'
                : 'file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png';
            ss.set_string('picture-uri', uri);
        } catch (e) {}
        try {
            const dock = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
            dock.set_string('background-color', isCyber ? '#0A1428' : '#788773');
        } catch (e) {}

        // Write user GTK CSS that imports the chosen radius style + stoplights
        this._writeGtkCss(isCyber);
    }

    _writeGtkCss(isCyber) {
        try {
            const home = GLib.get_home_dir();
            const dir = Gio.File.new_for_path(`${home}/.config/gtk-4.0`);
            dir.make_directory_with_parents(null);
            const css = Gio.File.new_for_path(`${home}/.config/gtk-4.0/gtk.css`);
            const style = isCyber ? 'cyberpunk' : 'japandi';
            const content = [
                '/* Mutsu OS theme — written by mutsu-branding */',
                `@import url('/usr/share/mutsu-os/branding/gtk/${style}.css');`,
                `@import url('/usr/share/mutsu-os/branding/gtk/stoplights.css');`,
                isCyber ? '.background { }' : '',
                '',
            ].join('\n');
            css.replace_contents(content, null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            log(`Mutsu branding: GTK CSS write failed (${e})`);
        }
    }

    _unloadStyle() {
        if (!this._activeStylesheet)
            return;
        try {
            St.ThemeContext.get_for_stage(global.stage)
                .get_theme().unload_stylesheet(this._activeStylesheet);
        } catch (error) {
            console.warn('Mutsu branding: theme unload failed', error);
        }
        this._activeStylesheet = null;
    }

    disable() {
        this._unloadStyle();
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._logoIcon = null;

        try {
            const activities = Main.panel.statusArea.activities;
            if (activities && this._activitiesWasVisible !== false)
                activities.show();
        } catch (e) {}

        this._settings = null;
    }
}
