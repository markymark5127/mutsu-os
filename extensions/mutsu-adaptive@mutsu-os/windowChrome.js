import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Tablet-mode GTK 4 / libadwaita title bars: traffic lights hidden (the
// default; gestures do their job) or finger-sized. Writes one file this extension owns, imported once from the
// user's gtk.css after the branding extension's mutsu-theme.css (so these
// sizes win). GTK reads user CSS when an app starts: apps opened after
// folding get the larger buttons; already-open apps keep theirs.

export const TABLET_CSS = `/* Mutsu tablet mode: finger-sized window controls.
 * Managed by mutsu-adaptive; emptied when tablet mode ends. Do not edit. */
windowcontrols {
  border-spacing: 14px;
  margin: 0 10px;
}
windowcontrols > button {
  min-width: 28px;
  min-height: 28px;
  background-size: 28px 28px;
}
headerbar {
  min-height: 56px;
}
`;

// Default in tablet mode: gestures close, minimize and tuck apps, so the
// traffic lights are redundant. GTK CSS has no display:none; shrink them away.
export const TABLET_CSS_NO_BUTTONS = `/* Mutsu tablet mode: window buttons hidden (gestures instead).
 * Managed by mutsu-adaptive; emptied when tablet mode ends. Do not edit. */
windowcontrols {
  border-spacing: 0;
  margin: 0;
  padding: 0;
}
windowcontrols > button {
  min-width: 0;
  min-height: 0;
  padding: 0;
  margin: 0;
  border: none;
  opacity: 0;
  background: none;
  box-shadow: none;
}
windowcontrols > button > image {
  -gtk-icon-size: 0;
}
headerbar {
  min-height: 52px;
}
`;
const EMPTY_CSS = '/* Mutsu tablet mode inactive. Managed by mutsu-adaptive. */\n';
const IMPORT = "@import url('mutsu-tablet.css');";

export function withImport(existing) {
    if (existing.includes('mutsu-tablet.css'))
        return null; // already imported
    return existing ? `${existing.trimEnd()}\n${IMPORT}\n` : `${IMPORT}\n`;
}

export function setTabletWindowChrome(on, {buttons = false} = {}) {
    try {
        const dir = `${GLib.get_home_dir()}/.config/gtk-4.0`;
        GLib.mkdir_with_parents(dir, 0o755);
        Gio.File.new_for_path(`${dir}/mutsu-tablet.css`).replace_contents(
            on ? (buttons ? TABLET_CSS : TABLET_CSS_NO_BUTTONS) : EMPTY_CSS, null, false, Gio.FileCreateFlags.NONE, null);
        if (!on)
            return;
        const gtkCss = Gio.File.new_for_path(`${dir}/gtk.css`);
        let existing = '';
        if (gtkCss.query_exists(null))
            existing = new TextDecoder().decode(gtkCss.load_contents(null)[1]);
        const next = withImport(existing);
        if (next !== null)
            gtkCss.replace_contents(next, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        log(`Mutsu Adaptive: could not update tablet window controls (${e})`);
    }
}
