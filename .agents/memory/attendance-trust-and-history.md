---
name: Attendance history and network trust
description: Intentional no-pairing tradeoff, historical mission policy, and atomic receipts.
---

Attendance progress sync uses the existing Denfi Points connection with no extra member/kiosk pairing step. A connected kiosk's admin may also change the shared mission, but that administrative action must be authenticated by Denfi Points; it is not progress pairing.

**Why:** The user explicitly wanted manual key pairing removed after configuring the Denfi Points server, but also expects saving the mission from Auto Shutdown to update Denfi Points for every kiosk. Progress sync favors setup simplicity over protection from untrusted LAN devices; changing reward rules has greater impact. Connectivity is not authentication.

**How to apply:** Do not add pairing to progress reports. Keep Denfi Points authoritative for a connected kiosk's mission; never silently save a conflicting local mission if the central save fails. Confirm the server address before forwarding admin credentials, and do not persist the password. HTTP on a trusted LAN is an acknowledged limitation, not proof of server identity; internet or untrusted-network access needs authenticated transport and server identity verification.

Delayed attendance reports must be evaluated using the server's policy for the day played, not today's configuration. Persist a received-progress acknowledgement and any confirmed award together.

**Why:** Network outages can cross midnight or policy changes, and a crash between separate writes can otherwise leave a confirmed reward missing from the kiosk permanently.

**How to apply:** Keep historical policy semantics and atomic local receipts when changing attendance rules, replay, or reward storage.