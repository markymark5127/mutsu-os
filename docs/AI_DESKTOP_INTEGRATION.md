# Spotlight search and setup walkthrough

These are developed in the **ai-desktop** repository and already ported into the Mutsu OS image.

## How it is wired

| Piece | Source | How it reaches the image |
|-------|--------|--------------------------|
| Spotlight launcher | `ai-desktop/src/aidesktop/ui.py`, `search.py` | Pinned via `packaging/desktop-source.env`, copied to `/usr/libexec/mutsu-os/src/` |
| Setup wizard | `ai-desktop/src/aidesktop/setup_wizard.py` | Same pin; launched with `mutsu-search --setup` |
| First-run trigger | `packaging/mutsu-first-login` | Autostart runs the wizard once until completed or skipped |
| Super+Space | `packaging/20-mutsu-shortcut.dconf` | Default shortcut for new users |

The current pin is commit `9fe8d1c7` of `markymark5127/ai-desktop`.

## What the wizard already covers

- Welcome + local app search exercise
- Appearance (Japandi / Cyberpunk / System) and keyboard profiles
- Mac-style dock settings
- Helper teaching style
- Optional AI / Newelle connection
- Phone pairing guidance (GSConnect)
- Gaming / Steam status

Adaptive Desktop (2-in-1 tablet mode) is **not** yet a wizard page in ai-desktop. The Shell extension in this repo owns that behavior.

## How to open them

```bash
mutsu-search          # Spotlight
mutsu-search --setup  # Setup wizard
```

When the Mutsu branding extension is enabled, the top-left logo menu also has **Mutsu Search** and **Setup Wizard** actions that call the same wrapper.

## Updating the pin

After changes land in ai-desktop, update `packaging/desktop-source.env` intentionally and re-run `packaging/prepare-desktop.sh` before the next image build.
