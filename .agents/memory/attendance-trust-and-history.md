---
name: Attendance history and network trust
description: Intentional no-pairing tradeoff, historical mission policy, and atomic receipts.
---

Attendance progress and shared-mission saves use the existing Denfi Points connection without a per-kiosk Denfi Points password or pairing step. The Auto Shutdown admin login controls the editing UI; the Points desktop server permits automatic mission writes from a directly attached private subnet. This is network trust, not cryptographic authentication of a kiosk.

**Why:** In a diskless shop, entering or retaining the Points admin password on every kiosk is impractical across resets. The user explicitly chose automatic shared-mission saves through the existing connection. Other devices on that subnet can impersonate kiosks, so this arrangement assumes an isolated, trusted shop network.

**How to apply:** Do not reintroduce per-kiosk passwords for connected mission saves. Keep Denfi Points authoritative; never silently save a conflicting local mission if the central save fails. On multi-network Points hosts, scope automatic writes to the intended shop subnet. When both apps run on the same PC, connect via its private LAN address, not localhost: a reverse proxy must not bypass the network trust check. Internet or untrusted-network access needs real authentication and server identity verification, not only an HTTP connection.

Delayed attendance reports must be evaluated using the server's policy for the day played, not today's configuration. Persist a received-progress acknowledgement and any confirmed award together.

**Why:** Network outages can cross midnight or policy changes, and a crash between separate writes can otherwise leave a confirmed reward missing from the kiosk permanently.

**How to apply:** Keep historical policy semantics and atomic local receipts when changing attendance rules, replay, or reward storage.

Only Auto Shutdown's admin panel edits the shared attendance mission. Denfi Points shows the mission read-only while continuing to store attendance days and award points. A play-time range chooses one stable target for everyone each calendar day; equal minimum and maximum values give a fixed target.

**Why:** The user explicitly wanted Auto Shutdown to be the sole settings editor, without losing Denfi Points' global history and rewards. A daily shared target must not change on refresh or restart, or reward results and historical calendar goals would disagree. Relying only on yesterday's cached target also breaks the mission if the server is offline across midnight.

**How to apply:** Keep kiosk-initiated mission saves distinct from the Denfi Points admin panel; mirror the central range and daily-selection seed to kiosks. Apply the same daily target to every member, including during outages, and evaluate delayed progress against the policy for its original day.

The active mission is play-time only; retain old login-day policies as history, but convert any active legacy login mission rather than awarding again on login. Preserve only the non-secret Denfi Points connection address outside Auto Shutdown's Windows install data so reinstalling the kiosk can reconnect and retrieve the central mission and already-synced member progress.

**Why:** A reinstall can replace kiosk-local settings and device identity without changing Denfi Points' authoritative member-day history. Keeping just the address outside the install avoids duplicating reward data while allowing reconnection.

**How to apply:** Keep Denfi Points as the source of rewards and attendance history. Never treat a kiosk's empty replacement data directory as evidence that a member has not completed today's mission. Do not duplicate or move reward records into the connection hint; unsynced local seconds can still be lost if the kiosk is removed while offline.