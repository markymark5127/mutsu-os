# Mutsu Adaptive Desktop

Mutsu's tablet layout builds on the bundled Touchshell GNOME extension.
Touchshell supplies panel auto-hide, top-edge controls, text-selection tools,
notification dismissal, window tiling, auto-maximization and GNOME overview gestures.
Adaptive supplies posture switching, the Home app grid and a dedicated Recent Apps view.

## Tablet controls

- Switch to Always Tablet from Quick Settings or the Mutsu panel menu.
- Existing and newly opened normal app windows maximize to the display work area.
- Tap the bottom Home indicator or swipe up quickly to return to the app grid.
- Swipe up slowly, or swipe up and pause before releasing, to open Recent Apps.
- Recent Apps is also available from the Mutsu panel menu.
- Scroll horizontally through window cards; tap a card to resume it.
- Swipe a card up at least 90 pixels to request a normal close. Remaining cards stay available.
- Tab through cards, Enter to resume, Delete to close, Escape or Done to dismiss the switcher.
- Home returns to the app grid. Closing the last card also returns Home.
- Unsaved-work dialogs are allowed to take focus; this never force-kills an application.

The adaptive switcher owns the bottom 24-pixel gesture area. Touchshell's competing
bottom-edge recognizer is suspended while tablet mode is active. Other Touchshell
features remain enabled. Previous Touchshell settings and window maximization state
are restored when leaving tablet mode. Gesture exceptions continue to apply.
The existing enable-experimental-gestures option applies to the legacy bottom handler;
the tablet Home indicator and switcher now provide the standard tablet navigation.

## Validation

Run `node tests/test_tablet_switcher.cjs extensions/mutsu-adaptive@mutsu-os/tabletSwitcher.js`
for gesture routing checks and `python -m unittest discover -s tests` for image contracts.
JavaScript syntax checks and these tests do not verify GNOME rendering.

Before shipping, boot the image in GNOME and check both portrait and landscape:
Home, app launch, horizontal card scrolling, swipe dismissal, an unsaved document,
multiple fingers, rotation, screen locking, the on-screen keyboard and mode restoration.
Live card rendering and GNOME Shell 46–50 compatibility require runtime verification.
Automatic hardware posture detection also needs convertible-device testing.

Recovery: `gnome-extensions disable mutsu-adaptive@mutsu-os`.
