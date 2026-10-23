# Adaptive Desktop — image-level plan

This document tracks how Mutsu OS (the bootc image) will deliver the convertible / 2-in-1 experience described in the ai-desktop product docs.

**Status (October 2026):** Experimental GNOME Shell extension prototype is installed but **disabled by default**. Manual Always Desktop / Always Tablet modes exist. Automatic posture detection is a scaffold only. Bottom-edge gestures are off unless an experimental setting is enabled. Live GNOME Shell and hardware testing is still required (see #14, #15, #16).

## Goal (from product vision)

On supported 2-in-1 hardware (Lenovo Yoga-class and similar):

- Detect real tablet posture via the kernel/libinput `SW_TABLET_MODE` switch (not merely rotation or missing keyboard events).
- On fold/detach: switch to tablet mode, reveal the Show Applications grid as Home, enlarge touch targets, maximize or tile newly launched apps, and enable gesture navigation.
- Gestures:
  - Swipe up from the bottom edge → return to Home / app grid.
  - Swipe up and hold → multitasking / Overview (show background windows).
  - Must not conflict with GNOME's existing bottom-edge on-screen keyboard gesture.
- On unfold: restore the Mac-like desktop (dock, normal scaling, windowed mode) without closing running applications.
- Always provide a manual Always Desktop / Always Tablet / Automatic control so the feature works even when hardware signals are imperfect.

## Image responsibilities (this repo)

1. Ship a GNOME Shell extension that owns posture detection, Home, and gestures.
2. Keep the extension **disabled by default** until GNOME Shell version compatibility and tablet behavior are verified. Do not overwrite Bazzite's `enabled-extensions` list.
3. Provide clear recovery instructions (`gnome-extensions disable mutsu-adaptive@mutsu-os`).
4. Keep the change reversible and avoid breaking keyboard/trackpad recovery or OSK gestures.

## Current implementation notes

- Extension UUID: `mutsu-adaptive@mutsu-os`
- Source: `extensions/mutsu-adaptive@mutsu-os/`
- Install script: `packaging/install-adaptive-extension.sh` (explicitly does not enable)
- `shell-version` is conservatively listed until real testing confirms broader support.
- Automatic mode does not yet listen for `SW_TABLET_MODE`.
- Experimental bottom-edge actor is gated behind a setting that defaults off.

## Next concrete steps

- Test the extension on the actual GNOME Shell version shipped by the Bazzite GNOME base in a disposable VM.
- Wire a real posture watcher (libinput / Mutter signal) for Automatic mode.
- Validate that disable() fully cleans up and that the extension can be turned off from Settings or a TTY.
- Document hardware QA requirements (real Yoga-class device + VM fallback) and attach evidence to issues #14–#16.

## Relationship to the ai-desktop app

The GTK Spotlight launcher remains available in both modes via Super+Space and touch search. Adaptive Desktop is a Shell integration, not a fullscreen GTK window. The app's onboarding wizard should eventually explain the mode and offer the manual toggle, but the posture logic lives in the Shell layer shipped by this image.

See also:
- ai-desktop `docs/ADAPTIVE_DESKTOP.md` (full product specification)
- ai-desktop `docs/PRODUCT_VISION.md`
- [INSTALL_AND_RECOVERY.md](INSTALL_AND_RECOVERY.md) for disable instructions
