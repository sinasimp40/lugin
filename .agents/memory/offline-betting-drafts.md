---
name: Offline betting drafts
description: Why disconnected Auto Shutdown may prepare betting odds without activating them.
---

Auto Shutdown may let an authenticated operator edit and persist a local betting draft while Denfi Points is unavailable. A local draft must never become the source for member spins. On reconnection, preserve the draft but require the operator to explicitly publish it to Denfi Points; do not silently overwrite live server settings.

**Why:** Operators need to configure the requested defaults before connecting the Points machine, but offline edits can be stale when a different kiosk or server admin has changed the live odds.

**How to apply:** Keep offline save, reconnect, and live publish as visibly distinct states in future changes to betting configuration. Gameplay and balances remain authoritative on Denfi Points.