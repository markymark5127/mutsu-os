# Mutsu tablet experience

Mutsu OS is a Mac-first desktop. When a 2-in-1 is folded into tablet posture,
the Adaptive Desktop extension turns it into an iPadOS-style tablet; unfolding
puts the desktop back exactly as it was.

## Switching

- **Automatic** (default) follows Mutter's tablet signal (libinput
  `SW_TABLET_MODE`, or a touchscreen with no keyboard/mouse attached), plus
  kernel tablet-mode switches and iio hinge sensors when present.
- The **Quick Settings toggle** overrides Automatic until the hinge next moves,
  so Automatic is never silently lost. The top-bar menu also offers Always
  Desktop / Always Tablet.
- Locking the screen keeps tablet mode running (windows and Split View
  survive); all tablet UI is hidden while locked.

## Home

Home sits behind every window, like the wallpaper. Any app that comes forward
covers it; when no app is in the way, Home shows through.

- Paged app grid that adapts to portrait and landscape. Swipe pages with your
  finger; the dots are tappable too.
- **Pull down** anywhere in the middle of Home to open **Mutsu Search**
  (or tap the Search pill). The top edge stays reserved for Notifications
  (centre) and Controls (right).
- Dock: your favourites, then up to three recently used apps. Running apps
  have a dot.
- **Long-press** an icon: Open/Show, New Window, Add to/Remove from Dock,
  Edit Home Screen, Quit.
- **Edit mode** (long-press then drag, long-press the wallpaper, or the menu):
  icons jiggle; drag to reorder, hold at a screen edge to change page, drop
  an app onto another to make a folder or onto a folder to join it. Tap Done.
- **Pages are kept**: an app stays on the page you drop it on. A full page
  pushes its last app to the next page; a smaller grid after rotation does
  the same instead of reshuffling everything.
- **Dock dragging**: drag an app onto the dock to add it (at the slot under
  your finger), along the dock to reorder, or off the dock to remove it.
  The app stays on Home either way. Folders cannot go in the dock.
- Folders open in place; tap the name to rename. Hold an app inside a
  folder and drag to pull it out onto Home (or use Remove from Folder).
- First run is alphabetical with games gathered into a Games folder (Steam
  stays on the grid). Reset from the extension preferences.

## Navigation (bottom edge)

- Short pull: temporary dock (on Home, where the dock is already showing,
  nothing extra appears).
- Swipe up: Home. The app follows your finger and shrinks away. Slide Over
  apps stay where they are, floating over Home.
- Swipe up and pause: **multitasking blades**.
- Swipe along the edge: previous/next app.
- Full-screen games keep the first swipe; it lights the Home indicator, and a
  second swipe within a couple of seconds navigates.
- Tap the Home indicator to go Home.

## Apps and windows

Apps open full screen (maximized) and keep their traffic lights:
close, minimize, and zoom. While folded, GTK 4 apps get finger-sized
traffic lights and a taller title bar (apps opened after folding; GTK reads
this style when an app starts). Zoom floats a window and it stays floating.
Windows that were open before tablet mode get their desktop size back when
tablet mode ends; apps you sent Home come back too.

## Multitasking blades

One tall blade per window, newest first, fanned in perspective, like iPadOS:
two Firefox windows (each with its own tabs) are two blades. Each blade is
titled with its app, shows that window and its title, and has its own
traffic lights.

- Tap a blade to open that window. Swipe sideways to browse.
- Swipe a blade **up** to close that window, **down** to minimize it. The
  app's other windows stay open. Closing uses the app's normal close, so
  unsaved-work prompts still appear.
- **Spaces** along the top filter by desktop; **+** adds one.
- Hold a blade and drag it onto another blade for **Split View**, onto a
  Space to move that window there, or to the right edge for **Slide Over**.
  The blade's Split View / Slide Over buttons do the same. On an app
  already in Slide Over the button is lit: tap it to make that app full
  screen again.
- Tap empty space, press Escape or Done to go back; Home goes Home.
- Keyboard: ←/→ browse, Enter opens, Delete closes, M minimizes.

## Split View, Slide Over and floating windows

- **From the dock:** while an app is open, pull up the dock, hold an app and
  drag it. Drop it at the left or right edge for **Split View** with the
  current app, or anywhere else above the dock for **Slide Over**. Dragging
  the app you're already using opens a second window of it.
- **Split View:** a wide divider resizes the pair within 30–70%; tap it to
  make the active app full screen. Closing one app expands the other.
  Rotation and the on-screen keyboard reflow the pair.
- **Slide Over** is a stack of phone-width apps floating above everything,
  including a Split View pair, so three apps can be on screen at once. On
  the handle above the floating app: drag left for the next app in the
  stack, drag right or tap to tuck the stack away. A tab at the right edge
  brings it back (tap or drag left). To leave Slide Over, **pull the handle
  down** (the app follows your finger; let go further down and it becomes
  the full-screen app), or tap the lit **Slide Over** button on its
  multitasking card. The green button, or moving it into Split View, also
  takes it out of the stack.
- **Floating windows:** the green button floats an app; a round grip at its
  bottom-right corner resizes it by touch. Move it by dragging its title bar.
- Fixed-size apps cannot be split or put in Slide Over.

## Settings safety

Every system setting tablet mode changes (text size,
rotation lock, Dash to Dock, Touchshell gestures) is recorded on disk
*before* it is changed. If GNOME Shell crashes or you log out in tablet mode,
your desktop settings are restored the next time the extension starts. A
setting you change yourself while in tablet mode is left as you set it.

## Requirements and limits

- Wayland session (Home lives in the compositor's background layer).
- GNOME Shell 46–50. Touch gestures, rotation and fold detection still need
  validation on real 2-in-1 hardware.
- Native app support decides how well text entry and window resizing behave.

## Verification

Run the Python suite and these Node checks from the repository root:

```
python3 -m unittest discover -s tests
node tests/test_tablet_switcher.cjs extensions/mutsu-adaptive@mutsu-os/tabletSwitcher.js
node tests/test_tablet_layout.cjs extensions/mutsu-adaptive@mutsu-os
node tests/test_tablet_keyboard.cjs extensions/mutsu-adaptive@mutsu-os/tabletKeyboard.js
node tests/test_tablet_dock.cjs extensions/mutsu-adaptive@mutsu-os/tabletDock.js
node tests/test_tablet_logic.cjs extensions/mutsu-adaptive@mutsu-os
node tests/test_tablet_ui.cjs extensions/mutsu-adaptive@mutsu-os
node tests/test_tablet_extension.cjs extensions/mutsu-adaptive@mutsu-os
```

These use simulated Shell objects and do not prove live rendering or hardware
behaviour. Before shipping, boot GNOME on a 2-in-1 and test: folding and
unfolding, the Quick Settings override, Home paging and pull-down search,
long-press menus, edit-mode drag/folders, launching from Home/dock/blades/
notifications, blades gestures and traffic lights, Spaces, Split View and
Slide Over, rotation, lock/unlock, a full-screen game, and a Shell restart
in tablet mode (settings must come back).

Recovery: `gnome-extensions disable mutsu-adaptive@mutsu-os`.
