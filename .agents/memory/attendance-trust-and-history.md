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

Only Auto Shutdown's admin panel edits the shared attendance mission. Denfi Points shows the mission read-only while continuing to store attendance days and award points. A play-time range chooses one stable target for everyone each calendar day; equal minimum and maximum values give a fixed target.

**Why:** The user explicitly wanted Auto Shutdown to be the sole settings editor, without losing Denfi Points' global history and rewards. A daily shared target must not change on refresh or restart, or reward results and historical calendar goals would disagree. Relying only on yesterday's cached target also breaks the mission if the server is offline across midnight.

**How to apply:** Keep kiosk-initiated mission saves distinct from the Denfi Points admin panel; mirror the central range and daily-selection seed to kiosks. Apply the same daily target to every member, including during outages, and evaluate delayed progress against the policy for its original day.

The active mission is play-time only; retain old login-day policies as history, but convert any active legacy login mission rather than awarding again on login. Preserve only the non-secret Denfi Points connection address outside Auto Shutdown's Windows install data so reinstalling the kiosk can reconnect and retrieve the central mission and already-synced member progress.

**Why:** A reinstall can replace kiosk-local settings and device identity without changing Denfi Points' authoritative member-day history. Keeping just the address outside the install avoids duplicating reward data while allowing reconnection.

**How to apply:** Keep Denfi Points as the source of rewards and attendance history. Never treat a kiosk's empty replacement data directory as evidence that a member has not completed today's mission. Do not duplicate or move reward records into the connection hint; unsynced local seconds can still be lost if the kiosk is removed while offline.