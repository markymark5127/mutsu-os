/* cc-mutsu-search-panel.c — Settings → Mutsu Search for Mutsu OS
 *
 * Copyright 2026 Mutsu OS contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Search keeps its settings in the user's own config; this page reads and
 * writes them through one helper (aidesktop.search_settings, installed as
 * /usr/libexec/mutsu-os/mutsu-search-settings), which prints JSON. The page
 * holds no copy of the rules: what the helper accepts is what Search uses.
 */

#include "cc-mutsu-search-panel.h"

#include <glib/gi18n.h>
#include <json-glib/json-glib.h>

#define HELPER "/usr/libexec/mutsu-os/mutsu-search-settings"
#define SEARCH_APP "/usr/bin/mutsu-search"

struct _CcMutsuSearchPanel {
    CcPanel parent_instance;

    AdwBanner *banner;
    AdwPreferencesGroup *intro_group;
    AdwSwitchRow *ai_row;
    AdwComboRow *provider_row;
    AdwSwitchRow *cloud_row;
    AdwActionRow *test_row;
    GtkButton *test_button;
    AdwComboRow *engine_row;
    AdwComboRow *theme_row;

    GStrv provider_keys;
    GStrv engine_keys;
    GStrv theme_keys;
    gboolean syncing;
    gboolean loaded;
    GCancellable *cancellable;
};

CC_PANEL_REGISTER (CcMutsuSearchPanel, cc_mutsu_search_panel)

typedef enum {
    REPLY_SNAPSHOT,
    REPLY_TEST,
} ReplyKind;

typedef struct {
    CcMutsuSearchPanel *self;
    ReplyKind kind;
} Request;

static void run_helper (CcMutsuSearchPanel *self, ReplyKind kind, const char *const *args);

/* ---- JSON helpers ------------------------------------------------------- */

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

/* [["key", "Label"], ...] + current key -> combo row model, keys, selection */
static void
fill_combo (AdwComboRow *row, GStrv *keys_out, JsonObject *object, const char *list_name,
            const char *current)
{
    JsonNode *node;
    JsonArray *array;
    g_autoptr(GStrvBuilder) keys = g_strv_builder_new ();
    GtkStringList *labels = gtk_string_list_new (NULL);
    guint selected = 0;
    guint count = 0;

    if (object == NULL || !json_object_has_member (object, list_name))
        goto done;
    node = json_object_get_member (object, list_name);
    if (node == NULL || JSON_NODE_TYPE (node) != JSON_NODE_ARRAY)
        goto done;
    array = json_node_get_array (node);
    for (guint i = 0; i < json_array_get_length (array); i++) {
        JsonNode *pair_node = json_array_get_element (array, i);
        JsonArray *pair;
        const char *key, *label;

        if (pair_node == NULL || JSON_NODE_TYPE (pair_node) != JSON_NODE_ARRAY)
            continue;
        pair = json_node_get_array (pair_node);
        if (json_array_get_length (pair) < 2)
            continue;
        key = json_array_get_string_element (pair, 0);
        label = json_array_get_string_element (pair, 1);
        if (key == NULL || label == NULL)
            continue;
        g_strv_builder_add (keys, key);
        gtk_string_list_append (labels, label);
        if (g_strcmp0 (key, current) == 0)
            selected = count;
        count++;
    }

done:
    g_strfreev (*keys_out);
    *keys_out = g_strv_builder_end (keys);
    adw_combo_row_set_model (row, G_LIST_MODEL (labels));
    g_object_unref (labels);
    if (count > 0)
        adw_combo_row_set_selected (row, selected);
}

static void
show_message (CcMutsuSearchPanel *self, const char *message)
{
    if (message == NULL || *message == '\0')
        return;
    adw_banner_set_title (self->banner, message);
    adw_banner_set_revealed (self->banner, TRUE);
}

/* ---- helper replies -------------------------------------------------------- */

static void
apply_snapshot (CcMutsuSearchPanel *self, JsonObject *data)
{
    gboolean ai_on = member_bool (data, "ai_enabled");
    const char *shortcut = member_string (data, "shortcut");
    g_autofree char *intro = NULL;

    self->syncing = TRUE;
    adw_switch_row_set_active (self->ai_row, ai_on);
    adw_switch_row_set_active (self->cloud_row, member_bool (data, "cloud_allowed"));
    fill_combo (self->provider_row, &self->provider_keys, data, "providers",
                member_string (data, "provider"));
    fill_combo (self->engine_row, &self->engine_keys, data, "search_engines",
                member_string (data, "search_engine"));
    fill_combo (self->theme_row, &self->theme_keys, data, "themes", member_string (data, "theme"));
    self->syncing = FALSE;
    self->loaded = TRUE;

    gtk_widget_set_sensitive (GTK_WIDGET (self->provider_row), ai_on);
    gtk_widget_set_sensitive (GTK_WIDGET (self->cloud_row), ai_on);
    gtk_widget_set_sensitive (GTK_WIDGET (self->test_button), ai_on);

    if (*shortcut != '\0')
        intro = g_strdup_printf (_("Open Search with %s. Type to find apps, files and settings, "
                                   "do quick sums, search the web, or ask Mutsu Mechanic."), shortcut);
    else
        intro = g_strdup (_("Type to find apps, files and settings, do quick sums, search the web, "
                            "or ask Mutsu Mechanic."));
    adw_preferences_group_set_description (self->intro_group, intro);
    show_message (self, member_string (data, "message"));
}

static void
on_helper_done (GObject *source, GAsyncResult *result, gpointer user_data)
{
    Request *request = user_data;
    CcMutsuSearchPanel *self = request->self;
    g_autoptr(GError) error = NULL;
    g_autofree char *out = NULL;
    g_autoptr(JsonParser) parser = NULL;
    JsonNode *root;
    JsonObject *data;

    if (!g_subprocess_communicate_utf8_finish (G_SUBPROCESS (source), result, &out, NULL, &error)) {
        if (!g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED)) {
            if (request->kind == REPLY_TEST)
                gtk_widget_set_sensitive (GTK_WIDGET (self->test_button), TRUE);
            show_message (self, _("Couldn't reach Mutsu Search's settings."));
        }
        g_free (request);
        return;
    }
    if (request->kind == REPLY_TEST)
        gtk_widget_set_sensitive (GTK_WIDGET (self->test_button), TRUE);

    parser = json_parser_new ();
    if (out == NULL || !json_parser_load_from_data (parser, out, -1, NULL) ||
        (root = json_parser_get_root (parser)) == NULL || JSON_NODE_TYPE (root) != JSON_NODE_OBJECT) {
        show_message (self, _("Mutsu Search's settings gave an answer this page didn't understand."));
        g_free (request);
        return;
    }
    data = json_node_get_object (root);

    if (json_object_has_member (data, "error")) {
        show_message (self, member_string (data, "error"));
        /* Put the controls back to what is actually saved. */
        run_helper (self, REPLY_SNAPSHOT, (const char *[]) { "get", NULL });
    } else if (request->kind == REPLY_TEST) {
        adw_action_row_set_subtitle (self->test_row, member_string (data, "message"));
    } else {
        apply_snapshot (self, data);
    }
    g_free (request);
}

static void
run_helper (CcMutsuSearchPanel *self, ReplyKind kind, const char *const *args)
{
    g_autoptr(GPtrArray) argv = g_ptr_array_new ();
    g_autoptr(GSubprocess) process = NULL;
    g_autoptr(GError) error = NULL;
    Request *request;

    g_ptr_array_add (argv, (gpointer) HELPER);
    for (guint i = 0; args[i] != NULL; i++)
        g_ptr_array_add (argv, (gpointer) args[i]);
    g_ptr_array_add (argv, NULL);

    process = g_subprocess_newv ((const char *const *) argv->pdata,
                                 G_SUBPROCESS_FLAGS_STDOUT_PIPE | G_SUBPROCESS_FLAGS_STDERR_SILENCE,
                                 &error);
    if (process == NULL) {
        show_message (self, _("Mutsu Search isn't installed."));
        return;
    }
    request = g_new0 (Request, 1);
    request->self = self;
    request->kind = kind;
    g_subprocess_communicate_utf8_async (process, NULL, self->cancellable, on_helper_done, request);
}

static void
set_value (CcMutsuSearchPanel *self, const char *key, const char *value)
{
    if (self->syncing || !self->loaded || value == NULL)
        return;
    run_helper (self, REPLY_SNAPSHOT, (const char *[]) { "set", key, value, NULL });
}

/* ---- controls --------------------------------------------------------------- */

static const char *
selected_key (AdwComboRow *row, GStrv keys)
{
    guint index = adw_combo_row_get_selected (row);

    if (keys == NULL || index == GTK_INVALID_LIST_POSITION || index >= g_strv_length (keys))
        return NULL;
    return keys[index];
}

static void
on_provider_changed (CcMutsuSearchPanel *self)
{
    set_value (self, "provider", selected_key (self->provider_row, self->provider_keys));
}

static void
on_engine_changed (CcMutsuSearchPanel *self)
{
    set_value (self, "search_engine", selected_key (self->engine_row, self->engine_keys));
}

static void
on_theme_changed (CcMutsuSearchPanel *self)
{
    set_value (self, "theme", selected_key (self->theme_row, self->theme_keys));
}

static void
on_ai_changed (CcMutsuSearchPanel *self)
{
    set_value (self, "ai_enabled", adw_switch_row_get_active (self->ai_row) ? "true" : "false");
}

static void
on_cloud_changed (CcMutsuSearchPanel *self)
{
    set_value (self, "cloud_allowed", adw_switch_row_get_active (self->cloud_row) ? "true" : "false");
}

static void
on_test_clicked (CcMutsuSearchPanel *self)
{
    gtk_widget_set_sensitive (GTK_WIDGET (self->test_button), FALSE);
    adw_action_row_set_subtitle (self->test_row, _("Asking Mutsu Mechanic a short test question…"));
    run_helper (self, REPLY_TEST, (const char *[]) { "test-ai", NULL });
}

static void
on_setup_activated (CcMutsuSearchPanel *self)
{
    g_autoptr(GError) error = NULL;
    g_autoptr(GSubprocess) process =
        g_subprocess_new (G_SUBPROCESS_FLAGS_NONE, &error, SEARCH_APP, "--setup", NULL);

    if (process == NULL)
        show_message (self, _("Couldn't open the welcome setup."));
}

static void
on_banner_button (CcMutsuSearchPanel *self)
{
    adw_banner_set_revealed (self->banner, FALSE);
}

static void
on_map (CcMutsuSearchPanel *self)
{
    /* The wizard or Search may have changed something: always reload. */
    run_helper (self, REPLY_SNAPSHOT, (const char *[]) { "get", NULL });
}

/* ---- construction ------------------------------------------------------------- */

static AdwComboRow *
combo_row (const char *title, const char *subtitle)
{
    AdwComboRow *row = ADW_COMBO_ROW (adw_combo_row_new ());

    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (row), title);
    adw_preferences_row_set_use_underline (ADW_PREFERENCES_ROW (row), TRUE);
    if (subtitle != NULL)
        adw_action_row_set_subtitle (ADW_ACTION_ROW (row), subtitle);
    return row;
}

static AdwSwitchRow *
switch_row (const char *title, const char *subtitle)
{
    AdwSwitchRow *row = ADW_SWITCH_ROW (adw_switch_row_new ());

    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (row), title);
    adw_preferences_row_set_use_underline (ADW_PREFERENCES_ROW (row), TRUE);
    adw_action_row_set_subtitle (ADW_ACTION_ROW (row), subtitle);
    return row;
}

static void
cc_mutsu_search_panel_dispose (GObject *object)
{
    CcMutsuSearchPanel *self = CC_MUTSU_SEARCH_PANEL (object);

    g_cancellable_cancel (self->cancellable);
    g_clear_object (&self->cancellable);
    g_clear_pointer (&self->provider_keys, g_strfreev);
    g_clear_pointer (&self->engine_keys, g_strfreev);
    g_clear_pointer (&self->theme_keys, g_strfreev);
    G_OBJECT_CLASS (cc_mutsu_search_panel_parent_class)->dispose (object);
}

static const char *
cc_mutsu_search_panel_get_help_uri (CcPanel *panel)
{
    return "https://github.com/markymark5127/mutsu-os#search";
}

static void
cc_mutsu_search_panel_class_init (CcMutsuSearchPanelClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS (klass);
    CcPanelClass *panel_class = CC_PANEL_CLASS (klass);

    object_class->dispose = cc_mutsu_search_panel_dispose;
    panel_class->get_help_uri = cc_mutsu_search_panel_get_help_uri;
}

static void
cc_mutsu_search_panel_init (CcMutsuSearchPanel *self)
{
    AdwToolbarView *toolbar = ADW_TOOLBAR_VIEW (adw_toolbar_view_new ());
    AdwPreferencesPage *page = ADW_PREFERENCES_PAGE (adw_preferences_page_new ());
    AdwPreferencesGroup *ai_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    AdwPreferencesGroup *web_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    AdwPreferencesGroup *look_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    AdwPreferencesGroup *setup_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    AdwButtonRow *setup_row;

    self->cancellable = g_cancellable_new ();
    adw_toolbar_view_add_top_bar (toolbar, adw_header_bar_new ());
    self->banner = ADW_BANNER (adw_banner_new (""));
    adw_banner_set_button_label (self->banner, _("_OK"));
    g_signal_connect_swapped (self->banner, "button-clicked", G_CALLBACK (on_banner_button), self);
    adw_toolbar_view_add_top_bar (toolbar, GTK_WIDGET (self->banner));

    /* What Search is. */
    self->intro_group = ADW_PREFERENCES_GROUP (adw_preferences_group_new ());
    adw_preferences_group_set_title (self->intro_group, _("Mutsu Search"));

    /* Mutsu Mechanic. */
    adw_preferences_group_set_title (ai_group, _("Mutsu Mechanic"));
    adw_preferences_group_set_description (ai_group,
        _("Mutsu Mechanic answers questions and helps fix problems. Its AI runs on this computer, "
          "so your questions stay here. It never changes anything without asking you first."));
    self->ai_row = switch_row (_("Use Mutsu Mechanic _AI"), _("Runs on this computer"));
    g_signal_connect_swapped (self->ai_row, "notify::active", G_CALLBACK (on_ai_changed), self);
    adw_preferences_group_add (ai_group, GTK_WIDGET (self->ai_row));

    self->provider_row = combo_row (_("_Answers From"), NULL);
    g_signal_connect_swapped (self->provider_row, "notify::selected", G_CALLBACK (on_provider_changed), self);
    adw_preferences_group_add (ai_group, GTK_WIDGET (self->provider_row));

    self->cloud_row = switch_row (_("Allow _Cloud AI Models"),
                                  _("Lets questions go to OpenAI or Claude when you pick them above"));
    g_signal_connect_swapped (self->cloud_row, "notify::active", G_CALLBACK (on_cloud_changed), self);
    adw_preferences_group_add (ai_group, GTK_WIDGET (self->cloud_row));

    self->test_row = ADW_ACTION_ROW (adw_action_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (self->test_row), _("Check Mutsu Mechanic"));
    adw_action_row_set_subtitle (self->test_row, _("Sends a short test question to the AI"));
    adw_action_row_set_subtitle_lines (self->test_row, 4);
    self->test_button = GTK_BUTTON (gtk_button_new_with_mnemonic (_("_Test")));
    gtk_widget_set_valign (GTK_WIDGET (self->test_button), GTK_ALIGN_CENTER);
    g_signal_connect_swapped (self->test_button, "clicked", G_CALLBACK (on_test_clicked), self);
    adw_action_row_add_suffix (self->test_row, GTK_WIDGET (self->test_button));
    adw_preferences_group_add (ai_group, GTK_WIDGET (self->test_row));

    /* The web. */
    adw_preferences_group_set_title (web_group, _("Web"));
    self->engine_row = combo_row (_("_Web Search"),
                                  _("Used only when you pick \"Search the web\" in the results"));
    g_signal_connect_swapped (self->engine_row, "notify::selected", G_CALLBACK (on_engine_changed), self);
    adw_preferences_group_add (web_group, GTK_WIDGET (self->engine_row));

    /* Look. */
    adw_preferences_group_set_title (look_group, _("Appearance"));
    self->theme_row = combo_row (_("_Style"), _("Search's look and the matching wallpaper"));
    g_signal_connect_swapped (self->theme_row, "notify::selected", G_CALLBACK (on_theme_changed), self);
    adw_preferences_group_add (look_group, GTK_WIDGET (self->theme_row));

    /* The welcome wizard. */
    setup_row = ADW_BUTTON_ROW (adw_button_row_new ());
    adw_preferences_row_set_title (ADW_PREFERENCES_ROW (setup_row), _("Run _Welcome Setup Again…"));
    adw_preferences_row_set_use_underline (ADW_PREFERENCES_ROW (setup_row), TRUE);
    g_signal_connect_swapped (setup_row, "activated", G_CALLBACK (on_setup_activated), self);
    adw_preferences_group_add (setup_group, GTK_WIDGET (setup_row));

    adw_preferences_page_add (page, self->intro_group);
    adw_preferences_page_add (page, ai_group);
    adw_preferences_page_add (page, web_group);
    adw_preferences_page_add (page, look_group);
    adw_preferences_page_add (page, setup_group);
    adw_toolbar_view_set_content (toolbar, GTK_WIDGET (page));
    adw_navigation_page_set_child (ADW_NAVIGATION_PAGE (self), GTK_WIDGET (toolbar));

    g_signal_connect (self, "map", G_CALLBACK (on_map), NULL);
}
