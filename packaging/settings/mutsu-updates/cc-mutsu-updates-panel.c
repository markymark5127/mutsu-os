/* cc-mutsu-updates-panel.c — Settings → Software Updates for Mutsu OS
 *
 * Copyright 2026 Mutsu OS contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * The panel never touches the system itself. It starts small systemd units
 * (mutsu-update-check/apply/rollback/auto-on/auto-off.service; polkit lets
 * local administrators start them without a password) and shows what the
 * privileged backend reports in /run/mutsu-update/state.json.
 */

#include "cc-mutsu-updates-panel.h"

#include <glib/gi18n.h>
#include <json-glib/json-glib.h>

#define STATE_FILE "/run/mutsu-update/state.json"

struct _CcMutsuUpdatesPanel {
    CcPanel parent_instance;

    AdwActionRow *version_row;
    AdwActionRow *status_row;
    GtkWidget *spinner; /* AdwSpinner */
    GtkProgressBar *progress;
    AdwButtonRow *primary_row;
    AdwSwitchRow *auto_row;
    AdwActionRow *rollback_row;
    GtkButton *rollback_button;
    AdwPreferencesGroup *rollback_group;

    guint poll_id;
    gint64 state_mtime;
    gboolean updating_auto;
    char *phase;
    gboolean available;
    gboolean staged;
    gboolean auto_on;
};

CC_PANEL_REGISTER (CcMutsuUpdatesPanel, cc_mutsu_updates_panel)

/* ---- helpers ------------------------------------------------------------- */

static JsonObject *
member_object (JsonObject *object, const char *name)
{
    JsonNode *node;

    if (object == NULL || !json_object_has_member (object, name))
        return NULL;
    node = json_object_get_member (object, name);
    if (node == NULL || JSON_NODE_TYPE (node) != JSON_NODE_OBJECT)
        return NULL;
    return json_node_get_object (node);
}

static const char *
member_string (JsonObject *object, const char *name)
{
    JsonNode *node;

    if (object == NULL || !json_object_has_member (object, name))
        return "";
    node = json_object_get_member (object, name);
    if (node == NULL || JSON_NODE_TYPE (node) != JSON_NODE_VALUE ||
        json_node_get_value_type (node) != G_TYPE_STRING)
        return "";
    return json_node_get_string (node);
}

static gboolean
member_bool (JsonObject *object, const char *name)
{
    JsonNode *node;

    if (object == NULL || !json_object_has_member (object, name))
        return FALSE;
    node = json_object_get_member (object, name);
    if (node == NULL || JSON_NODE_TYPE (node) != JSON_NODE_VALUE ||
        json_node_get_value_type (node) != G_TYPE_BOOLEAN)
        return FALSE;
    return json_node_get_boolean (node);
}

static double
member_fraction (JsonObject *object, const char *name)
{
    JsonNode *node;

    if (object == NULL || !json_object_has_member (object, name))
        return -1;
    node = json_object_get_member (object, name);
    if (node == NULL || JSON_NODE_TYPE (node) != JSON_NODE_VALUE)
        return -1;
    return json_node_get_double (node);
}

/* "43.20261110.0" + "2026-11-10T22:00:00Z" -> "43.20261110.0 · November 10, 2026" */
static char *
describe_version (JsonObject *deployment)
{
    const char *version = member_string (deployment, "version");
    const char *timestamp = member_string (deployment, "timestamp");
    g_autoptr(GDateTime) when = NULL;
    g_autofree char *date = NULL;

    if (deployment == NULL)
        return g_strdup (_("Unknown"));
    if (*timestamp != '\0')
        when = g_date_time_new_from_iso8601 (timestamp, NULL);
    if (when != NULL)
        date = g_date_time_format (when, "%B %-d, %Y");
    if (*version != '\0' && date != NULL)
        return g_strdup_printf ("%s · %s", version, date);
    if (*version != '\0')
        return g_strdup (version);
    if (date != NULL)
        return g_strdup_printf (_("Built %s"), date);
    return g_strdup (_("Unknown"));
}

static void
start_unit (CcMutsuUpdatesPanel *self, const char *unit)
{
    g_autoptr(GError) error = NULL;
    g_autoptr(GDBusConnection) bus = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, &error);

    if (bus == NULL) {
        g_warning ("Mutsu updates: no system bus: %s", error->message);
        return;
    }
    g_dbus_connection_call (bus, "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
                            "org.freedesktop.systemd1.Manager", "StartUnit",
                            g_variant_new ("(ss)", unit, "replace"), NULL,
                            G_DBUS_CALL_FLAGS_ALLOW_INTERACTIVE_AUTHORIZATION, -1,
                            NULL, NULL, NULL);
}

static void
restart_computer (void)
{
    g_autoptr(GError) error = NULL;
    g_autoptr(GDBusConnection) bus = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);

    if (bus == NULL)
        return;
    /* GNOME's own restart dialog (save work, cancel). */
    g_dbus_connection_call (bus, "org.gnome.SessionManager", "/org/gnome/SessionManager",
                            "org.gnome.SessionManager", "Reboot", NULL, NULL,
                            G_DBUS_CALL_FLAGS_NONE, -1, NULL, NULL, NULL);
}

/* ---- state -> widgets ---------------------------------------------------- */

static void
apply_state (CcMutsuUpdatesPanel *self, JsonObject *state)
{
    const char *phase = member_string (state, "phase");
    const char *message = member_string (state, "message");
    const char *error = member_string (state, "error");
    JsonObject *booted = member_object (state, "booted");
    JsonObject *rollback = member_object (state, "rollback");
    double fraction = member_fraction (state, "progress");
    gboolean busy;
    g_autofree char *version = describe_version (booted);

    g_free (self->phase);
    self->phase = g_strdup (*phase ? phase : "idle");
    self->available = member_bool (state, "available");
    self->staged = g_str_equal (self->phase, "staged") || g_str_equal (self->phase, "rollback-staged");
    self->auto_on = member_bool (state, "auto");

    adw_action_row_set_subtitle (self->version_row, version);

    busy = g_str_equal (self->phase, "checking") || g_str_equal (self->phase, "downloading") ||
           g_str_equal (self->phase, "installing-apps") || g_str_equal (self->phase, "rolling-back");
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->status_row),
                                   *message ? message : _("Check for updates to see what's new."));
    adw_action_row_set_subtitle (self->status_row,
                                 g_str_equal (self->phase, "error") && *error ? error : "");
    gtk_widget_set_visible (self->spinner, busy && fraction < 0);
    gtk_widget_set_visible (GTK_WIDGET (self->progress), busy && fraction >= 0);
    if (fraction >= 0)
        gtk_progress_bar_set_fraction (self->progress, fraction);

    gtk_widget_remove_css_class (GTK_WIDGET (self->primary_row), "suggested-action");
    gtk_widget_set_sensitive (GTK_WIDGET (self->primary_row), !busy);
    if (self->staged) {
        adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->primary_row), _("_Restart to Finish"));
        gtk_widget_add_css_class (GTK_WIDGET (self->primary_row), "suggested-action");
    } else if (self->available) {
        adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->primary_row), _("_Download and Install"));
        gtk_widget_add_css_class (GTK_WIDGET (self->primary_row), "suggested-action");
    } else {
        adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->primary_row), _("_Check for Updates"));
    }

    self->updating_auto = TRUE;
    adw_switch_row_set_active (self->auto_row, self->auto_on);
    self->updating_auto = FALSE;

    if (rollback != NULL) {
        g_autofree char *previous = describe_version (rollback);
        adw_action_row_set_subtitle (self->rollback_row, previous);
    }
    gtk_widget_set_visible (GTK_WIDGET (self->rollback_group), rollback != NULL);
    gtk_widget_set_sensitive (GTK_WIDGET (self->rollback_button), !busy);
}

static gboolean
poll_state (gpointer user_data)
{
    CcMutsuUpdatesPanel *self = CC_MUTSU_UPDATES_PANEL (user_data);
    g_autoptr(GFile) file = g_file_new_for_path (STATE_FILE);
    g_autoptr(GFileInfo) info = NULL;
    g_autoptr(JsonParser) parser = NULL;
    g_autofree char *contents = NULL;
    gsize length = 0;
    gint64 mtime;
    JsonNode *root;

    info = g_file_query_info (file, G_FILE_ATTRIBUTE_TIME_MODIFIED "," G_FILE_ATTRIBUTE_TIME_MODIFIED_USEC,
                              G_FILE_QUERY_INFO_NONE, NULL, NULL);
    if (info == NULL)
        return G_SOURCE_CONTINUE;
    mtime = g_file_info_get_attribute_uint64 (info, G_FILE_ATTRIBUTE_TIME_MODIFIED) * G_USEC_PER_SEC +
            g_file_info_get_attribute_uint32 (info, G_FILE_ATTRIBUTE_TIME_MODIFIED_USEC);
    if (mtime == self->state_mtime)
        return G_SOURCE_CONTINUE;
    if (!g_file_get_contents (STATE_FILE, &contents, &length, NULL))
        return G_SOURCE_CONTINUE;
    parser = json_parser_new ();
    if (!json_parser_load_from_data (parser, contents, length, NULL))
        return G_SOURCE_CONTINUE;
    root = json_parser_get_root (parser);
    if (root == NULL || JSON_NODE_TYPE (root) != JSON_NODE_OBJECT)
        return G_SOURCE_CONTINUE;
    self->state_mtime = mtime;
    apply_state (self, json_node_get_object (root));
    return G_SOURCE_CONTINUE;
}

/* ---- actions --------------------------------------------------------------- */

static void
on_primary_activated (CcMutsuUpdatesPanel *self)
{
    if (self->staged)
        restart_computer ();
    else if (self->available)
        start_unit (self, "mutsu-update-apply.service");
    else
        start_unit (self, "mutsu-update-check.service");
}

static void
on_auto_changed (CcMutsuUpdatesPanel *self)
{
    if (self->updating_auto)
        return;
    start_unit (self, adw_switch_row_get_active (self->auto_row) ?
                      "mutsu-update-auto-on.service" : "mutsu-update-auto-off.service");
}

static void
on_rollback_response (AdwAlertDialog *dialog, const char *response, CcMutsuUpdatesPanel *self)
{
    if (g_str_equal (response, "rollback"))
        start_unit (self, "mutsu-update-rollback.service");
}

static void
on_rollback_clicked (CcMutsuUpdatesPanel *self)
{
    AdwDialog *dialog = adw_alert_dialog_new (_("Go Back to the Previous Version?"),
                                              _("Your files and apps stay as they are. The previous version of "
                                                "Mutsu OS starts the next time you restart, and you can update "
                                                "again later."));

    adw_alert_dialog_add_responses (ADW_ALERT_DIALOG (dialog),
                                    "cancel", _("_Cancel"),
                                    "rollback", _("_Go Back"),
                                    NULL);
    adw_alert_dialog_set_response_appearance (ADW_ALERT_DIALOG (dialog), "rollback",
                                              ADW_RESPONSE_DESTRUCTIVE);
    adw_alert_dialog_set_default_response (ADW_ALERT_DIALOG (dialog), "cancel");
    adw_alert_dialog_set_close_response (ADW_ALERT_DIALOG (dialog), "cancel");
    g_signal_connect (dialog, "response", G_CALLBACK (on_rollback_response), self);
    adw_dialog_present (dialog, GTK_WIDGET (self));
}

static void
on_map (CcMutsuUpdatesPanel *self)
{
    /* Fresh version info whenever the page is shown. */
    if (!g_file_test (STATE_FILE, G_FILE_TEST_EXISTS))
        start_unit (self, "mutsu-update-status.service");
    poll_state (self);
    if (self->poll_id == 0)
        self->poll_id = g_timeout_add (700, poll_state, self);
}

static void
on_unmap (CcMutsuUpdatesPanel *self)
{
    g_clear_handle_id (&self->poll_id, g_source_remove);
}

/* ---- construction ------------------------------------------------------------ */

static void
cc_mutsu_updates_panel_dispose (GObject *object)
{
    CcMutsuUpdatesPanel *self = CC_MUTSU_UPDATES_PANEL (object);

    g_clear_handle_id (&self->poll_id, g_source_remove);
    g_clear_pointer (&self->phase, g_free);
    G_OBJECT_CLASS (cc_mutsu_updates_panel_parent_class)->dispose (object);
}

static const char *
cc_mutsu_updates_panel_get_help_uri (CcPanel *panel)
{
    return "https://github.com/markymark5127/mutsu-os#updates";
}

static void
cc_mutsu_updates_panel_class_init (CcMutsuUpdatesPanelClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS (klass);
    CcPanelClass *panel_class = CC_PANEL_CLASS (klass);

    object_class->dispose = cc_mutsu_updates_panel_dispose;
    panel_class->get_help_uri = cc_mutsu_updates_panel_get_help_uri;
}

static void
cc_mutsu_updates_panel_init (CcMutsuUpdatesPanel *self)
{
    AdwToolbarView *toolbar = ADW_TOOLBAR_VIEW (adw_toolbar_view_new ());
    AdwPreferencesPage *page = ADW_PREFERENCES_PAGE (adw_preferences_page_new ());
    AdwPreferencesGroup *system_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    AdwPreferencesGroup *auto_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    AdwPreferencesGroup *action_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    GtkWidget *status_suffix = gtk_box_new (GTK_ORIENTATION_HORIZONTAL, 6);

    adw_toolbar_view_add_top_bar (toolbar, adw_header_bar_new ());

    adw_preferences_group_set_title (system_group, "Mutsu OS");
    adw_preferences_group_set_description (system_group,
        _("Mutsu OS updates as a whole, like a phone: the new version is prepared in the background "
          "and starts when you restart. Your apps from Flathub are updated at the same time."));

    self->version_row = ADW_ACTION_ROW (adw_action_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->version_row), _("Installed Version"));
    gtk_widget_add_css_class (GTK_WIDGET (self->version_row), "property");
    adw_preferences_group_add (system_group, GTK_WIDGET (self->version_row));

    self->status_row = ADW_ACTION_ROW (adw_action_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->status_row),
                                   _("Check for updates to see what's new."));
    adw_action_row_set_subtitle_lines (self->status_row, 3);
    self->spinner = adw_spinner_new ();
    self->progress = GTK_PROGRESS_BAR (gtk_progress_bar_new ());
    gtk_widget_set_size_request (GTK_WIDGET (self->progress), 140, -1);
    gtk_widget_set_valign (GTK_WIDGET (self->progress), GTK_ALIGN_CENTER);
    gtk_widget_set_visible (self->spinner, FALSE);
    gtk_widget_set_visible (GTK_WIDGET (self->progress), FALSE);
    gtk_box_append (GTK_BOX (status_suffix), self->spinner);
    gtk_box_append (GTK_BOX (status_suffix), GTK_WIDGET (self->progress));
    adw_action_row_add_suffix (self->status_row, status_suffix);
    adw_preferences_group_add (system_group, GTK_WIDGET (self->status_row));

    self->primary_row = ADW_BUTTON_ROW (adw_button_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->primary_row), _("_Check for Updates"));
    adw_preferences_row_set_use_underline (ADW_PREFERENCES_ROW (self->primary_row), TRUE);
    g_signal_connect_swapped (self->primary_row, "activated", G_CALLBACK (on_primary_activated), self);
    adw_preferences_group_add (action_group, GTK_WIDGET (self->primary_row));

    self->auto_row = ADW_SWITCH_ROW (adw_switch_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->auto_row), _("_Automatic Updates"));
    adw_preferences_row_set_use_underline (ADW_PREFERENCES_ROW (self->auto_row), TRUE);
    adw_action_row_set_subtitle (ADW_ACTION_ROW (self->auto_row),
                                 _("Download updates in the background. They start when you restart."));
    adw_switch_row_set_active (self->auto_row, TRUE);
    g_signal_connect_swapped (self->auto_row, "notify::active", G_CALLBACK (on_auto_changed), self);
    adw_preferences_group_add (auto_group, GTK_WIDGET (self->auto_row));

    self->rollback_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    adw_preferences_group_set_title (self->rollback_group, _("Previous Version"));
    self->rollback_row = ADW_ACTION_ROW (adw_action_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->rollback_row), _("Go Back if Something Broke"));
    self->rollback_button = GTK_BUTTON (gtk_button_new_with_mnemonic (_("_Go Back…")));
    gtk_widget_set_valign (GTK_WIDGET (self->rollback_button), GTK_ALIGN_CENTER);
    g_signal_connect_swapped (self->rollback_button, "clicked", G_CALLBACK (on_rollback_clicked), self);
    adw_action_row_add_suffix (self->rollback_row, GTK_WIDGET (self->rollback_button));
    adw_preferences_group_add (self->rollback_group, GTK_WIDGET (self->rollback_row));
    gtk_widget_set_visible (GTK_WIDGET (self->rollback_group), FALSE);

    adw_preferences_page_add (page, system_group);
    adw_preferences_page_add (page, action_group);
    adw_preferences_page_add (page, auto_group);
    adw_preferences_page_add (page, self->rollback_group);
    adw_toolbar_view_set_content (toolbar, GTK_WIDGET (page));
    adw_navigation_page_set_child (ADW_NAVIGATION_PAGE (self), GTK_WIDGET (toolbar));

    g_signal_connect (self, "map", G_CALLBACK (on_map), NULL);
    g_signal_connect (self, "unmap", G_CALLBACK (on_unmap), NULL);
}
