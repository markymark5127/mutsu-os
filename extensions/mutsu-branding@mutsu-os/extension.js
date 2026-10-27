/*
 * Mutsu OS GNOME Shell branding.
 * Top-left Mutsu logo with a Mac-style menu. Hides Activities while enabled.
 */
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import Gio from 'gi://Gio';
import St from 'gi://St';

const BASE = '/usr/share/mutsu-os/branding/shell';
const JAPANDI_SYMBOL = '/usr/share/mutsu-os/branding/icons/mutsu-logo-symbolic.svg';
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
        // The symbolic white logo disappeared against our cream Japandi bar.
        // Use the dark symbol in light mode; white in dark/cyberpunk mode.
        const iconPath = name === 'japandi' ? JAPANDI_SYMBOL : DARK_SYMBOL;
        this._logoIcon.gicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(iconPath),
        });
        if (!['japandi', 'cyberpunk'].includes(name))
            return;
        const file = Gio.File.new_for_path(`${BASE}/${name}.css`);
        try {
            if (!file.query_exists(null))
                return;
            const shellTheme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            shellTheme.load_stylesheet(file);
            this._activeStylesheet = file;
        } catch (error) {
            console.warn('Mutsu branding: could not load theme', error);
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
