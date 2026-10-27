# Adaptive Desktop — image-level plan

This document tracks how Mutsu OS (the bootc image) will deliver the convertible / 2-in-1 experience described in the ai-desktop product docs.

**Status (October 2026):** Experimental GNOME Shell extension is installed but **disabled by default**. Phases 1–4 are implemented in code:

- Phase 1: Manual modes, debounced transitions, app-grid Home, maximize-on-launch, Quick Settings toggle.
- Phase 2: Experimental bottom-edge gestures (gated off) + fullscreen/game exception list.
- Phase 3: Temporary touch text scaling (reversible, respects user/a11y), best-effort dock autohide, optional rotation lock.
- Phase 4: Reversible state save/restore, gesture exceptions, clear recovery path.

Automatic posture detection remains a scaffold. Live GNOME Shell and hardware testing is still required.

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
2. Enable the extension as a **core first-login Mutsu default**, composed with existing vendor GNOME extensions. Automatic hinge detection and touch gestures still require GNOME 50/hardware QA; do not imply runtime verification from source tests.
3. Provide clear recovery instructions (`gnome-extensions disable mutsu-adaptive@mutsu-os`).
4. Keep the change reversible and avoid breaking keyboard/trackpad recovery or OSK gestures.

## Current implementation notes

- Extension UUID: `mutsu-adaptive@mutsu-os`
- Source: `extensions/mutsu-adaptive@mutsu-os/`
- Install script: `packaging/install-adaptive-extension.sh` (installs only); `packaging/configure-native-desktop.py` enables the extension through system-wide GNOME defaults.
- Settings added in Phases 2–4: `touch-text-scale`, `collapse-dock-in-tablet`, `rotation-lock`, `gesture-exceptions`.
- Automatic mode is not yet wired to a verified `SW_TABLET_MODE` source. If no working signal is available, it safely remains in desktop mode; manual tablet mode is available.
- Experimental bottom-edge actor is gated behind a setting that defaults off.

## Remaining for production

- Wire a real posture watcher (libinput / Mutter signal) for Automatic mode.
- Hardware QA on a real Yoga-class device + a second 2-in-1 (boot in tablet, rapid fold/unfold, suspend/resume, external keyboard, a11y, games).
- Confirm gestures coexist with OSK, notification shade, and lock screen.
- First-run wizard page that explains the mode (lives in the ai-desktop app).

## Relationship to the ai-desktop app

The GTK Spotlight launcher remains available in both modes via Super+Space and touch search. Adaptive Desktop is a Shell integration, not a fullscreen GTK window. The app's onboarding wizard should eventually explain the mode and offer the manual toggle, but the posture logic lives in the Shell layer shipped by this image.

See also:
- ai-desktop `docs/ADAPTIVE_DESKTOP.md` (full product specification)
- ai-desktop `docs/PRODUCT_VISION.md`
- [INSTALL_AND_RECOVERY.md](INSTALL_AND_RECOVERY.md) for disable instructions
