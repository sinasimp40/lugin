---
name: Betting game presentation
description: Confirmed dice rules, wheel presentation, private odds, and delayed balance/result disclosure.
---

The member-facing Spin the Wheel display should use a horizontal multiplier roll with equal-sized tiles and should not expose configured win percentages. Equal-size tiles are presentation, not a claim that results are equally likely. Keep settlement and configured probabilities authoritative on Denfi Points.

**Why:** The user explicitly disliked the visibly unequal sectors of the original wheel, asked for a more balanced-looking horizontal roll, and wanted the winning rates hidden from players.

**How to apply:** Maintain this distinction when changing animation, player APIs, or admin controls; admins still need to set percentages, while players should see only possible multipliers and the actual server result.

HIGH / LOW DICE is alongside Spin the Wheel, not a replacement. Only one game may be enabled at a time; both may be disabled. The user confirmed TWO dice: LOW is 2–6, HIGH is 8–12, 7 always loses, and a win returns 2× INCLUDING the original stake. Dice winning/losing percentages are admin-only and saved centrally on Denfi Points for every PC.

**Why:** These are the owner's explicitly confirmed game and operating rules, rather than assumptions about a conventional dice game.

**How to apply:** Preserve the exact ranges, losing seven, inclusive payout, and exclusive game selection when changing admin controls, member screens, settlement, or fake-points testing.

Dice should visibly roll, with a slower result reveal for suspense rather than an immediate face change.

**Why:** The owner explicitly requested a rolling dice animation and a slower, more suspenseful result.

**How to apply:** Preserve the roll and suspense when revising Dice presentation; keep points and voice behind the confirmed reveal, and respect reduced-motion settings.

Randomize reel presentation independently of the admin outcome order, without changing published odds or choosing a different monetary result.

**Why:** The owner noticed the same repeating visual pattern followed the admin arrangement and requested a less predictable display.

**How to apply:** Shuffle the visual sequence for each spin, but always reveal the confirmed Points result. Keep retry identity, payouts, and delayed balance disclosure independent of visual randomization.

Treat LOSE (0×) as an operator-controlled outcome, not as an automatically calculated remainder. It may be edited or removed, and no replacement chance should be silently added. Require all configured outcome chances to total exactly 100% before saving.

**Why:** The operator specifically wanted to change or delete the default 35% LOSE chance. Automatically restoring that chance or redistributing the other chances would override their intended odds.

**How to apply:** When adding or changing outcomes in the admin panel, show an invalid total until the operator explicitly adjusts chances. Denfi Points should persist exactly the distribution that was published.

Do not show a spin's changed points balance in any member-facing session display until the reel has confirmed the result, including when a live status update arrives first. Keep Denfi Points settlement authoritative rather than postponing the server transaction for an animation.

**Why:** Denfi Points may settle a spin before the reel finishes; an early live points update reveals whether the member won or lost before the result appears.

**How to apply:** Review new session balance consumers and retry paths for premature disclosure; the session should reveal the confirmed balance with the reel result, and an unconfirmed retry must not expose it beforehand.

Cross-PC win announcements must originate from the shared Points ledger, not from the winning kiosk's local WebSocket. Only positive net results are public, and the winner's own session must not display the announcement until its reel reveals the outcome. Win voice must reach all PCs without announcing the member's current points; loss voice is only for the player's own PC.

**Why:** Each diskless kiosk has a separate local session server; a local-only event cannot reach the other PCs. Announcing directly on settlement would also spoil the winning member's reel. The owner explicitly required all-PC wins without current points and player-PC-only losses.

**How to apply:** Keep announcements idempotent by spin identity, tolerate session WebSocket startup and reconnect races, and never include private odds or financial details in the shared feed.

The owner describes betting as “offline gambling, not real money—it’s points for my computer shop.”

**Why:** The owner corrected the cash-gambling interpretation while discussing voice samples.

**How to apply:** Respect this description of the betting feature. It is not an instruction to remove the separately requested cash-withdrawal feature. If a provider’s licensing or usage rules depend on redeemability, clarify the betting-specific rules rather than assuming solely from the word “Points” or from another feature.