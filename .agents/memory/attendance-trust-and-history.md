---
name: Attendance trust and history
description: Why central attendance sync needs signed messages, historical mission policy, and atomic receipts.
---

Treat attendance pairing as a trust boundary even on a local network. Never transmit the reusable shared key in requests, and authenticate both submitted progress and mission configuration returned to a kiosk.

**Why:** Kiosks commonly use HTTP to reach Denfi Points on the LAN. A bearer key or unsigned response could let a network observer forge rewards or disable local time tracking.

**How to apply:** When extending central sync, preserve request and response integrity, reject stale/replayed submissions, and avoid accepting unsigned mission settings.

Delayed attendance reports must be evaluated using the server's policy for the day played, not today's configuration. Persist a received-progress acknowledgement and any confirmed award together.

**Why:** Network outages can cross midnight or policy changes, and a crash between separate writes can otherwise leave a confirmed reward missing from the kiosk permanently.

**How to apply:** Keep historical policy semantics and atomic local receipts when changing attendance rules, replay, or reward storage.