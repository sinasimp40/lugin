---
name: Betting game presentation
description: Why the member-facing game uses an equal-size horizontal reel while preserving configured odds.
---

The member-facing Betting Games display should use a horizontal multiplier roll with equal-sized tiles and should not expose configured win percentages. Equal-size tiles are presentation, not a claim that results are equally likely. Keep settlement and configured probabilities authoritative on Denfi Points.

**Why:** The user explicitly disliked the visibly unequal sectors of the original wheel, asked for a more balanced-looking horizontal roll, and wanted the winning rates hidden from players.

**How to apply:** Maintain this distinction when changing animation, player APIs, or admin controls; admins still need to set percentages, while players should see only possible multipliers and the actual server result.

Treat LOSE (0×) as an operator-controlled outcome, not as an automatically calculated remainder. It may be edited or removed, and no replacement chance should be silently added. Require all configured outcome chances to total exactly 100% before saving.

**Why:** The operator specifically wanted to change or delete the default 35% LOSE chance. Automatically restoring that chance or redistributing the other chances would override their intended odds.

**How to apply:** When adding or changing outcomes in the admin panel, show an invalid total until the operator explicitly adjusts chances. Denfi Points should persist exactly the distribution that was published.

Do not show a spin's changed points balance in any member-facing session display until the reel has confirmed the result, including when a live status update arrives first. Keep Denfi Points settlement authoritative rather than postponing the server transaction for an animation.

**Why:** Denfi Points may settle a spin before the reel finishes; an early live points update reveals whether the member won or lost before the result appears.

**How to apply:** Review new session balance consumers and retry paths for premature disclosure; the session should reveal the confirmed balance with the reel result, and an unconfirmed retry must not expose it beforehand.