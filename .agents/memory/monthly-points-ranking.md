---
name: Monthly points ranking
description: The durable rules for monthly point totals, rollover reporting, and historical logs.
---

The monthly leaderboard is a view over timestamped coin logs, not a destructive deletion of those logs. Current-month member points and rankings reset automatically by filtering on the local calendar month. At the first check of a new month, the previous month’s top five converted-point totals are sent to the configured Telegram channel once, tracked by a persisted reported-period marker.

**Why:** Admin history and audit records should remain available after a ranking reset, while players need a clean monthly competition and the owner needs a rollover record.

**How to apply:** Any future ranking, session-points, or sync-server changes must preserve the current-month filter and converted `points` values. Do not clear the underlying coin log file as part of a monthly reset. Session order and ranking drawers should size to their rendered content rather than introducing an internal scrollbar.