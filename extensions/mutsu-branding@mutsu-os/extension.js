/*
 * Opt-in Mutsu OS GNOME Shell branding.
 * Does not remove/replace Activities or globally alter Bazzite extensions.
 * Tested shell-version range must be narrowed/expanded using live VM checks.
 */
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import Gio from 'gi://Gio';
import St from 'gi://St';

const BASE = '/usr/share/mutsu-os/branding/shell';
const SYMBOL = '/usr/share/mutsu-os/branding/icons/mutsu-logo-symbolic-white.svg';

export default class MutsuBrandingExtension extends Extension {
    enable() {
        this._activeStylesheet = null;
        this._settings = this.getSettings();
        this._indicator = new PanelMenu.Button(0.0, 'Mutsu OS', false);
        const file = Gio.File.new_for_path(SYMBOL);
        this._indicator.add_child(new St.Icon({
            gicon: new Gio.FileIcon({file}),
            style_class: 'system-status-icon',
        }));
        this._indicator.menu.addAction('Mutsu OS Search', () => {
            try {
                Gio.Subprocess.new(['/usr/bin/mutsu-search'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                console.warn('Mutsu branding: Search unavailable', e);
            }
        });
        this._indicator.menu.addAction('Calm Japandi', () => this._settings.set_string('appearance', 'japandi'));
        this._indicator.menu.addAction('Cyberpunk', () => this._settings.set_string('appearance', 'cyberpunk'));
        this._indicator.menu.addAction('Follow System', () => this._settings.set_string('appearance', 'system'));
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'left');
        this._changedId = this._settings.connect('changed::appearance', () => this._applyAppearance());
        this._applyAppearance();
    }

    _applyAppearance() {
        this._unloadStyle();
        const name = this._settings.get_string('appearance');
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
        this._settings = null;
    }
}
