// Plain resizable GTK 4 app window for the GNOME runtime check (a normal
// toplevel, unlike zenity's dialogs). Usage: gjs -m test-window.js TITLE
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import {programArgs} from 'system';

const title = programArgs[0] ?? 'Mutsu test';
const app = new Gtk.Application({
    application_id: `org.mutsuos.RuntimeTest.${title.replace(/[^A-Za-z0-9]/g, '')}`,
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});
app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({application: app, title, default_width: 640, default_height: 480});
    win.set_child(new Gtk.Label({label: title}));
    win.present();
});
app.run([]);
