---
name: Betting game presentation
description: Why the member-facing game uses an equal-size horizontal reel while preserving configured odds.
---

The member-facing Betting Games display should use a horizontal multiplier roll with equal-sized tiles and should not expose configured win percentages. Equal-size tiles are presentation, not a claim that results are equally likely. Keep settlement and configured probabilities authoritative on Denfi Points.

**Why:** The user explicitly disliked the visibly unequal sectors of the original wheel, asked for a more balanced-looking horizontal roll, and wanted the winning rates hidden from players.

**How to apply:** Maintain this distinction when changing animation, player APIs, or admin controls; admins still need to set percentages, while players should see only possible multipliers and the actual server result.