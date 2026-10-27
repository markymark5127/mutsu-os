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

        this._changedId = this._settings.connect('changed::appearance', () => this._applyAppearance(true));
        this._applyAppearance(false);
    }

    _launch(argv) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn('Mutsu branding: launch failed', argv, e);
        }
    }

    _applyAppearance(explicitChange = false) {
        this._unloadStyle();
        const name = this._settings.get_string('appearance');
        const isCyber = name === 'cyberpunk';
        const isJapandi = name === 'japandi';
        const isSystem = name === 'system';

        // Logo always follows current mode
        const iconPath = isJapandi ? JAPANDI_SYMBOL : DARK_SYMBOL;
        this._logoIcon.gicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(iconPath),
        });

        if (isSystem) {
            // Follow System: unload custom shell CSS; restore prior user values
            // only if we previously overrode them.
            if (explicitChange)
                this._restoreSystemDefaults();
            return;
        }

        if (!isJapandi && !isCyber)
            return;

        // Shell stylesheet (safe to load on every enable)
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

        // Only write user preferences on an explicit menu choice.
        // On enable we load the shell look but do not clobber GSettings or gtk.css.
        if (explicitChange)
            this._applyDesktopTheme(isCyber);
    }

    _applyDesktopTheme(isCyber) {
        try {
            const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            iface.set_string('color-scheme', isCyber ? 'prefer-dark' : 'prefer-light');
            iface.set_string('accent-color', isCyber ? 'blue' : 'green');
            iface.set_string('icon-theme', isCyber ? 'MutsuCyberpunk' : 'MutsuJapandi');
        } catch (e) {
            log(`Mutsu branding: interface settings failed (${e})`);
        }
        try {
            const gdm = new Gio.Settings({ schema_id: 'org.gnome.login-screen' });
            const logo = isCyber
                ? '/usr/share/mutsu-os/branding/icons/mutsu-login-cyberpunk.svg'
                : '/usr/share/pixmaps/mutsu/mutsu-login-wordmark.png';
            gdm.set_string('logo', logo);
        } catch (e) {}
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

        this._writeGtkCss(isCyber);
        this._refreshGtkApps();
        this._syncAppearanceFile(isCyber ? 'cyberpunk' : 'japandi');
    }

    _restoreSystemDefaults() {
        // Clear the Mutsu-controlled GTK import and let dconf defaults show through.
        this._removeGtkImport();
        this._syncAppearanceFile('system');
    }

    _writeGtkCss(isCyber) {
        try {
            const home = GLib.get_home_dir();
            const dir = Gio.File.new_for_path(`${home}/.config/gtk-4.0`);
            dir.make_directory_with_parents(null);
            // Our controlled file — never touch a user's gtk.css contents.
            const mutsuCss = Gio.File.new_for_path(`${home}/.config/gtk-4.0/mutsu-theme.css`);
            const style = isCyber ? 'cyberpunk' : 'japandi';
            const content = [
                '/* Mutsu OS theme — controlled by mutsu-branding. Do not edit. */',
                `@import url('/usr/share/mutsu-os/branding/gtk/${style}.css');`,
                `@import url('/usr/share/mutsu-os/branding/gtk/stoplights.css');`,
                '',
            ].join('\n');
            mutsuCss.replace_contents(content, null, false, Gio.FileCreateFlags.NONE, null);
            // Append a single import to gtk.css only if missing.
            this._ensureGtkImport(home);
        } catch (e) {
            log(`Mutsu branding: GTK CSS write failed (${e})`);
        }
    }

    _ensureGtkImport(home) {
        const gtkCss = Gio.File.new_for_path(`${home}/.config/gtk-4.0/gtk.css`);
        const importLine = '@import url(\'mutsu-theme.css\');';
        let existing = '';
        try {
            if (gtkCss.query_exists(null)) {
                const [, contents] = gtkCss.load_contents(null);
                existing = new TextDecoder().decode(contents);
            }
        } catch (e) {}
        if (existing.includes('mutsu-theme.css'))
            return;
        const next = existing ? existing.trimEnd() + '\n' + importLine + '\n' : importLine + '\n';
        gtkCss.replace_contents(next, null, false, Gio.FileCreateFlags.NONE, null);
    }

    _removeGtkImport() {
        try {
            const home = GLib.get_home_dir();
            const gtkCss = Gio.File.new_for_path(`${home}/.config/gtk-4.0/gtk.css`);
            if (!gtkCss.query_exists(null))
                return;
            const [, contents] = gtkCss.load_contents(null);
            let text = new TextDecoder().decode(contents);
            text = text.split('\n').filter(l => !l.includes('mutsu-theme.css')).join('\n');
            gtkCss.replace_contents(text, null, false, Gio.FileCreateFlags.NONE, null);
            // Remove our controlled file
            const mutsuCss = Gio.File.new_for_path(`${home}/.config/gtk-4.0/mutsu-theme.css`);
            if (mutsuCss.query_exists(null))
                mutsuCss.delete(null);
        } catch (e) {}
    }

    _syncAppearanceFile(mode) {
        // Single source of truth: GSettings is canonical. Mirror to the file
        // ai-desktop already reads so Search and the welcome wizard stay in sync.
        try {
            const home = GLib.get_home_dir();
            const dir = Gio.File.new_for_path(`${home}/.config/ai-desktop`);
            dir.make_directory_with_parents(null);
            const f = Gio.File.new_for_path(`${home}/.config/ai-desktop/appearance.json`);
            const body = JSON.stringify({ appearance: mode }) + '\n';
            f.replace_contents(body, null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {}
    }

    _refreshGtkApps() {
        // Force running GTK apps to re-read CSS by touching the files and
        // briefly flipping gtk-theme (apps that watch GSettings reload).
        try {
            const home = GLib.get_home_dir();
            for (const name of ['gtk.css', 'mutsu-theme.css']) {
                const f = Gio.File.new_for_path(`${home}/.config/gtk-4.0/${name}`);
                if (f.query_exists(null))
                    f.set_attribute_uint64('time::modified', GLib.get_real_time(), Gio.FileQueryInfoFlags.NONE, null);
            }
        } catch (e) {}
        try {
            const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            const current = iface.get_string('gtk-theme');
            iface.set_string('gtk-theme', 'Adwaita');
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                try {
                    iface.set_string('gtk-theme', current || 'Adwaita');
                } catch (e) {}
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            log(`Mutsu branding: GTK refresh failed (${e})`);
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
