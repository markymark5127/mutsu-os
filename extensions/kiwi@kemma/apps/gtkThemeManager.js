// SPDX-License-Identifier: GPL-3.0-or-later
// Generates GTK CSS imports for window controls and titlebar tweaks based on settings.
//
// Imports are written only to the user's ~/.config/gtk-{3,4}.0/gtk.css so the
// extension never writes inside its own installation directory. This keeps
// system-wide installs (e.g. /usr/share/gnome-shell/extensions, owned by root)
// working. See https://github.com/kem-a/kiwi-kemma/issues/86

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MARKER_BEGIN = '/* Kiwi (is not Apple) - managed imports: begin */';
const MARKER_END = '/* Kiwi (is not Apple) - managed imports: end */';

// Matches the whole managed block, including the markers themselves.
const MANAGED_BLOCK_REGEX = /\/\* Kiwi \(is not Apple\) - managed imports: begin \*\/[\s\S]*?\/\* Kiwi \(is not Apple\) - managed imports: end \*\/\n?/g;

// Matches any single-line @import pointing into the extension, in any quoting
// style. Cleans up the unmarked imports written by versions <= 1.9.1.
const LEGACY_IMPORT_REGEX = /^[^\n]*@import[^\n]*kiwi@kemma[^\n]*\n?/gm;

let gtkThemeManager = null;

class GtkThemeManager {
    constructor(ext) {
        this._extension = ext;
        this._settings = null;
        this._settingsChangedId = null;
    }

    // Mutsu: the stylesheets (and the button images they use) are copied
    // next to the user's gtk.css, in kiwi/, and imported by relative path.
    // Flatpak apps (Firefox, Thunderbird...) read ~/.config/gtk-*.0 but can't
    // see /usr/share/gnome-shell/extensions, so absolute imports into the
    // extension failed there ("file does not exist").
    _copyTree(source, dest) {
        const info = source.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            GLib.mkdir_with_parents(dest.get_path(), 0o755);
            const children = source.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let child;
            while ((child = children.next_file(null)))
                this._copyTree(source.get_child(child.get_name()), dest.get_child(child.get_name()));
            children.close(null);
        } else {
            source.copy(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
        }
    }

    _stageAssets(gtkConfigDir, sheets) {
        const kiwiDir = Gio.File.new_for_path(GLib.build_filenamev([gtkConfigDir, 'kiwi']));
        const root = Gio.File.new_for_path(this._extension.path);
        GLib.mkdir_with_parents(kiwiDir.get_child('css').get_path(), 0o755);
        for (const name of sheets)
            root.get_child('css').get_child(name).copy(kiwiDir.get_child('css').get_child(name),
                Gio.FileCopyFlags.OVERWRITE, null, null);
        for (const folder of ['titlebuttons', 'titlebuttons-glass']) {
            const source = root.get_child('icons').get_child(folder);
            if (source.query_exists(null))
                this._copyTree(source, kiwiDir.get_child('icons').get_child(folder));
        }
    }

    _cssUri(name) {
        return `kiwi/css/${name}`;
    }

    // Stylesheets to pull in for a given GTK major version ('3' or '4').
    _stylesheetsFor(version) {
        const enableAppButtons = this._settings.get_boolean('enable-app-window-buttons');
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const fullscreenOnly = this._settings.get_boolean('show-window-controls-fullscreen-only');
        const buttonType = this._settings.get_string('button-type');
        const buttonSize = this._settings.get_string('button-size');
        const appFixes = this._settings.get_boolean('popup-menu-styling');

        const sheets = [];

        // Titlebutton styling only if app window buttons are enabled
        if (enableAppButtons) {
            if (buttonType === 'titlebuttons-alt') {
                sheets.push(`titlebuttons-alt${version}.css`);
            } else {
                sheets.push(`titlebuttons${version}.css`);
                // Glass only overrides the images of the default set
                if (buttonType === 'titlebuttons-glass')
                    sheets.push(`titlebuttons-glass${version}.css`);
            }

            if (buttonSize === 'small') {
                sheets.push(`titlebuttons-size-small${version}.css`);
                if (buttonType === 'titlebuttons-glass')
                    sheets.push(`titlebuttons-glass-size-small${version}.css`);
            }
        }

        // Hide the titlebar when window controls live in the panel
        if (showControlsOnPanel) {
            if (fullscreenOnly)
                sheets.push(`hide-titlebar-fullscreen${version}.css`);
            else
                sheets.push(`hide-titlebar${version}.css`);
        }

        // App fixes go last so they can override the above
        if (appFixes)
            sheets.push(`fixes${version}.css`);

        return sheets;
    }

    _buildManagedBlock(version) {
        const sheets = this._stylesheetsFor(version);
        if (!sheets.length)
            return '';

        const imports = sheets.map(name => `@import url("${this._cssUri(name)}");`);
        return `${MARKER_BEGIN}\n${imports.join('\n')}\n${MARKER_END}\n`;
    }

    async updateGtkCss() {
        const configDir = GLib.get_user_config_dir();

        for (const version of ['3', '4']) {
            const gtkConfigDir = GLib.build_filenamev([configDir, `gtk-${version}.0`]);
            GLib.mkdir_with_parents(gtkConfigDir, 0o755);

            const userPath = GLib.build_filenamev([gtkConfigDir, 'gtk.css']);
            const sheets = this._stylesheetsFor(version);
            if (sheets.length) {
                try {
                    this._stageAssets(gtkConfigDir, sheets);
                } catch (error) {
                    console.error(`[Kiwi] Error copying GTK stylesheets: ${error}`);
                }
            }
            await this.processUserGtkFile(userPath, this._buildManagedBlock(version));
        }
    }

    // Replaces our managed block in the user's gtk.css, leaving their own rules
    // untouched. An empty block removes our imports entirely.
    async processUserGtkFile(filePath, managedBlock) {
        try {
            const file = Gio.File.new_for_path(filePath);
            const exists = file.query_exists(null);

            if (!exists && !managedBlock)
                return;

            let existingContent = '';
            if (exists) {
                const [contents] = await file.load_contents_async(null);
                existingContent = new TextDecoder().decode(contents);
            }

            // Strip any previous block, plus unmarked imports from older versions
            existingContent = existingContent
                .replace(MANAGED_BLOCK_REGEX, '')
                .replace(LEGACY_IMPORT_REGEX, '');

            // Our imports come first so user rules can still override them
            const newContent = managedBlock + existingContent;

            if (!newContent.trim()) {
                // Nothing but our own content was in there
                if (exists)
                    file.delete(null);
                return;
            }

            file.replace_contents(newContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (error) {
            console.error(`[Kiwi] Error processing GTK file ${filePath}: ${error}`);
        }
    }

    async removeUserGtkConfig() {
        const configDir = GLib.get_user_config_dir();

        for (const version of ['3', '4']) {
            const userPath = GLib.build_filenamev([configDir, `gtk-${version}.0`, 'gtk.css']);
            await this.processUserGtkFile(userPath, '');
        }
    }

    enable() {
        this._settings = this._extension.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'enable-app-window-buttons' || key === 'button-type' || key === 'button-size' || key === 'show-window-controls' || key === 'show-window-controls-fullscreen-only' || key === 'popup-menu-styling') {
                this.updateGtkCss().catch(error => {
                    console.error(`[Kiwi] Error in settings changed handler: ${error}`);
                });
            }
        });

        // Initial update
        this.updateGtkCss().catch(error => {
            console.error(`[Kiwi] Error in initial update: ${error}`);
        });
    }

    disable() {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
        this._settings = null;

        // Remove our imports from user GTK config files
        this.removeUserGtkConfig().catch(error => {
            console.error(`[Kiwi] Error in disable cleanup: ${error}`);
        });

        this._extension = null;
    }
}

export function enable(ext) {
    Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
    if (!gtkThemeManager) {
        gtkThemeManager = new GtkThemeManager(ext);
        gtkThemeManager.enable();
    }
}

export function disable() {
    if (gtkThemeManager) {
        gtkThemeManager.disable();
        gtkThemeManager = null;
    }
}
