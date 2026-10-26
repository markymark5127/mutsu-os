# P0 / P1 implementation status

Updated on `feature/p0-p1`.

## Implemented in this branch

### Top-left Mutsu logo (P1)
- `extensions/mutsu-branding@mutsu-os` now places a Mutsu logo button at the top-left of the panel and hides the stock Activities button while the extension is enabled.
- Activities is restored on disable.
- Extension remains **disabled by default** in the image.

### Adaptive Desktop posture (P1)
- The adaptive extension now attempts to connect to a Mutter tablet-mode signal (`tablet-mode` / similar) when present.
- If no signal is available it logs and stays in manual mode (Always Desktop / Always Tablet still work).
- Gestures, touch scale, dock collapse, and exception list are unchanged and still gated.

## Still requires hardware / VM verification (P0)

- Fresh qcow2/ISO boot and first-run wizard.
- Confirm Anaconda sidebar branding is actually applied on a built ISO.
- Confirm Plymouth splash appears after the theme install.
- Live GNOME Shell test of both extensions (enable / disable / recovery).
- Real 2-in-1 `SW_TABLET_MODE` confirmation.

## How to test

```bash
# On a disposable VM booted into a new image
gnome-extensions enable mutsu-branding@mutsu-os
# Confirm top-left shows Mutsu logo and Activities is hidden.

gnome-extensions enable mutsu-adaptive@mutsu-os
# Use Quick Settings or panel menu to toggle Always Tablet / Always Desktop.

gnome-extensions disable mutsu-branding@mutsu-os
gnome-extensions disable mutsu-adaptive@mutsu-os
```
