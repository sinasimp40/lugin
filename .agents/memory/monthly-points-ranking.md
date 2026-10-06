---
name: Monthly points ranking
description: The durable rules for monthly point totals, rollover reporting, and historical logs.
---

The monthly leaderboard is a view over timestamped coin logs, not a destructive deletion of those logs. Only rankings reset by filtering on the local calendar month. Spendable member balances carry over across months and include historical credits and debits. At the first check of a new month, the previous month’s top five converted-point totals are sent to the configured Telegram channel once, tracked by a persisted reported-period marker.

**Why:** The owner clarified that a fresh monthly competition must not erase earned, spendable points. Earlier guidance conflated monthly ranking scores with wallet balances; that guidance is superseded. Admin history and audit records must remain available.

**How to apply:** Keep the current-month filter on ranking/report queries only, never wallet reads or betting balance checks. Preserve converted points and signed historical debits. Do not clear the underlying coin log file as part of a monthly reset. Session order and ranking drawers should size to their rendered content rather than introducing an internal scrollbar.

Admin manual point additions and deductions affect both the spendable balance and the current-month ranking score.

**Why:** When asked whether manual changes should affect only balances or both balances and rankings, the owner explicitly selected “Balance and monthly rankings.”

**How to apply:** Record signed adjustments at the time the admin confirms them. Include them in that month’s ranking and the lifetime balance; do not backdate them or treat them as coin payments or playing time.