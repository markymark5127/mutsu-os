# Mutsu tablet experience

Mutsu builds on the bundled Touchshell and native GNOME app grid, keyboard,
Quick Settings and notification system. Desktop settings are restored on exit.

## Navigation

Enable **Bottom swipe gestures** in Adaptive Desktop preferences. The opt-in
remains off by default; Home and Recent Apps also have accessible buttons/menus.

- Short pull from the bottom edge: reveal a temporary dock with favorite and running apps.
- Longer upward swipe: Home. The current app preview follows the finger and fades into Home.
- Longer upward swipe and pause: Recent Apps.
- Horizontal swipe along the bottom edge: previous/next recent app. Consecutive swipes cycle through the recent-app list.
- The temporary dock dismisses after an app selection, an outside tap, focus change or five seconds.
- Tap the Home indicator to return Home.
- Search is available from the Home widget and the existing global shortcut.

Recent Apps supports finger-tracked vertical dismissal, horizontal card scrolling,
keyboard navigation and ordinary application close requests (including unsaved-work prompts).

## Two-app layouts

Open Recent Apps, tap **Split View** on one card, then tap another card.
A wide divider resizes the pair within a 30–70% range. Tap the divider to maximize
the active app, or use **Full screen** on a card. Closing one app expands its companion.
Rotation reflows the pair; the layout accounts for the on-screen keyboard on its monitor.
Fixed-size apps cannot use this layout. Applications can enforce minimum sizes;
small portrait screens may not fit two desktop applications comfortably.

## Home, keyboard and controls

- Native GNOME app-grid pagination, icon long-press menus, folder creation and rearrangement are retained.
  The former invisible pull-down search catcher has been removed so it cannot steal icon gestures.
- An optional local clock/date widget and Search, Controls, Notifications and Keyboard buttons appear on Home.
  The widget rearranges for portrait and respects the system's 12/24-hour clock setting.
- Quick Settings and notifications use Touchshell's top-edge gestures, with larger touch targets.
- Native GNOME text-field keyboard handling is enabled temporarily, with a preference to turn this off.
  In tablet mode, the native keyboard spans the active display width with larger
  rectangular key targets. Its height adapts to portrait/landscape orientation,
  and desktop sizing is restored on exit. The bottom gesture indicator is hidden
  while the keyboard is visible.
- Dock auto-hide, keyboard accessibility, rotation lock and Touchshell settings restore on leaving tablet mode.
- The default desktop auto-maximizer skips the compact Mutsu Search surface.

The widget is a clock/date and shortcut strip, not a general third-party widget platform.
Native app support determines how well text entry, folders and window resizing behave.

## Verification

Run the Python suite and these Node checks from the repository root:

```
python3 -m unittest discover -s tests
node tests/test_tablet_switcher.cjs extensions/mutsu-adaptive@mutsu-os/tabletSwitcher.js
node tests/test_tablet_layout.cjs extensions/mutsu-adaptive@mutsu-os
node tests/test_tablet_keyboard.cjs extensions/mutsu-adaptive@mutsu-os/tabletKeyboard.js
node tests/test_tablet_dock.cjs extensions/mutsu-adaptive@mutsu-os/tabletDock.js
```

CI runs gesture, layout, settings-restoration and JavaScript syntax checks.
These use simulated shell objects and do not prove live rendering or hardware behavior.
Before shipping, boot GNOME and test touchscreen navigation, cancelled gestures,
text fields in GTK and non-GTK apps, portrait/landscape rotation, two-app minimum sizes,
lock/unlock, notifications, icon long presses/folders, and repeated mode changes.
Automatic fold detection and GNOME Shell 46–50 compatibility need real-device validation.

Recovery: `gnome-extensions disable mutsu-adaptive@mutsu-os`.
