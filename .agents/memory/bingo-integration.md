---
name: Shared Bingo integration
description: Owner-requested upstream Bingo integration and distinct custom-card policy.
---

The owner wants upstream Bingo available in both Auto Shutdown and Denfi Points,
including recent-winner popups, voice, and the Telegram command workflow.

**Why:** The owner explicitly requested adding Bingo “like in the repo” to both
Windows applications, rather than only showing a browser sample.

**How to apply:** Preserve local theme, full-username, logo and CPU fixes during
upstream integrations. Keep Points authoritative for entries, shared settings,
draws and payouts; do not use kiosk-local balances as authority.

Bingo has its own shared custom-card setting: enabled allows a whole-number card
amount; disabled allows one card for one point. Existing events retain their
starting rules. This is separate from wheel/dice custom stakes and daily limits.

**Why:** The owner requested custom bets only when enabled in the admin panel and
Points. The upstream implementation lacked that switch, so the integration adds
an explicit Bingo policy instead of coupling special events to ordinary betting.

**How to apply:** Enforce the policy centrally as well as in the UI. Treat an old
Points build that cannot confirm the switch as incompatible, not as a successful
publication. Preserve all-winner announcements, per-winning-card prize shares,
and exactly-once debits/refunds.
