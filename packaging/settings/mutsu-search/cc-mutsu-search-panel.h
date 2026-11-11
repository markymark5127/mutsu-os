/* cc-mutsu-search-panel.h — Settings → Mutsu Search for Mutsu OS
 *
 * Copyright 2026 Mutsu OS contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#pragma once

#include <shell/cc-panel.h>

G_BEGIN_DECLS

#define CC_TYPE_MUTSU_SEARCH_PANEL (cc_mutsu_search_panel_get_type ())
G_DECLARE_FINAL_TYPE (CcMutsuSearchPanel, cc_mutsu_search_panel, CC, MUTSU_SEARCH_PANEL, CcPanel)

G_END_DECLS
