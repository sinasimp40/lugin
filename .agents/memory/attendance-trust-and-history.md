---
name: Attendance history and network trust
description: Intentional no-pairing tradeoff, historical mission policy, and atomic receipts.
---

Attendance sync uses the existing Denfi Points connection with no extra member/kiosk pairing step.

**Why:** The user explicitly wanted manual key pairing removed after configuring the Denfi Points server. This favors setup simplicity over protection from untrusted LAN devices. Connectivity is not authentication.

**How to apply:** Do not reintroduce an admin key prompt without discussing the user-facing tradeoff. Treat the LAN as trusted and be candid that exposed sync endpoints can be abused; if internet exposure becomes necessary, plan a different secure deployment.

Delayed attendance reports must be evaluated using the server's policy for the day played, not today's configuration. Persist a received-progress acknowledgement and any confirmed award together.

**Why:** Network outages can cross midnight or policy changes, and a crash between separate writes can otherwise leave a confirmed reward missing from the kiosk permanently.

**How to apply:** Keep historical policy semantics and atomic local receipts when changing attendance rules, replay, or reward storage.