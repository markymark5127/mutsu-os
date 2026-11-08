// Plain resizable GTK 4 app window for the GNOME runtime check (a normal
// toplevel, unlike zenity's dialogs). Usage: gjs -m test-window.js TITLE
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {programArgs} from 'system';

const title = programArgs[0] ?? 'Mutsu test';
// Optional second argument: a raw window class, e.g. steam_app_570 to look
// like a game Steam launched (not a valid application ID, so it is set as
// the program name, which GTK sends as the Wayland app ID).
const rawClass = programArgs[1] ?? null;
if (rawClass)
    GLib.set_prgname(rawClass);
const app = new Gtk.Application({
    application_id: rawClass ? null : `org.mutsuos.RuntimeTest.${title.replace(/[^A-Za-z0-9]/g, '')}`,
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});
app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({application: app, title, default_width: 640, default_height: 480});
    win.set_child(new Gtk.Label({label: title}));
    win.present();
});
app.run([]);
