/* cc-mutsu-updates-panel.h — Settings → Software Updates for Mutsu OS
 *
 * Copyright 2026 Mutsu OS contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#pragma once

#include <shell/cc-panel.h>

G_BEGIN_DECLS

#define CC_TYPE_MUTSU_UPDATES_PANEL (cc_mutsu_updates_panel_get_type ())
G_DECLARE_FINAL_TYPE (CcMutsuUpdatesPanel, cc_mutsu_updates_panel, CC, MUTSU_UPDATES_PANEL, CcPanel)

G_END_DECLS
