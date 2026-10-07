---
name: Offline betting drafts
description: Offline betting compatibility and the owner's simplified Auto Shutdown Betting panel.
---

The owner requested removal of the offline “Save local draft” action, unsaved/local-draft notice, “Reload latest policy and discard these edits” button, and fake-points test-bench link from Auto Shutdown → Betting. Keep the live Publish action available when connected; do not reintroduce these removed controls.

**Why:** The user explicitly asked to remove these items from this admin panel.

**How to apply:** Simplify the Auto Shutdown admin surface without deleting the standalone test page or existing saved configurations. Refreshing the page may discard edits and reload the shared policy after a publishing conflict.

Previously saved drafts and backend draft compatibility must never activate member betting automatically. Denfi Points remains authoritative; require explicit verified publishing before local settings affect live games.

**Why:** Offline edits can be stale after another kiosk changes the shared policy. Removing UI controls does not authorize deleting stored drafts or auto-publishing them.

**How to apply:** Preserve saved configurations and the central publishing safety checks; do not treat offline edits as live settings.