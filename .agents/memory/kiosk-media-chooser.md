---
name: Kiosk media chooser
description: Why desktop admin media selection needs a guarded modal instead of a raw file input
---

The Auto Shutdown kiosk's fullscreen, always-on-top lock screen actively reclaims focus. Admin media selection should use a modal Electron file chooser attached to that window. Pause focus reclamation only for the duration of an authorized chooser, then restore kiosk and focus enforcement even if the chooser is canceled or errors.

**Why:** A native file input on the locked desktop could leave the chooser behind the fullscreen window, making it appear stuck with no usable Cancel/back path. Leaving the kiosk focus guard suspended after selection would weaken the lock screen.

**How to apply:** When changing admin uploads or lock-screen focus behavior, preserve both the parented chooser and its guaranteed focus-guard restoration. A browser preview cannot confirm native Windows dialog stacking; desktop verification is still needed when altering this interaction.