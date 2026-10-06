---
name: Attendance history and network trust
description: Intentional no-pairing tradeoff, server-owned attendance time, and historical mission policy.
---

Attendance progress and shared-mission saves use the existing Denfi Points connection without a per-kiosk Denfi Points password or pairing step. The Auto Shutdown admin login controls the editing UI; the Points desktop server permits automatic mission writes from a directly attached private subnet. This is network trust, not cryptographic authentication of a kiosk.

**Why:** In a diskless shop, entering or retaining the Points admin password on every kiosk is impractical across resets. The user explicitly chose automatic shared-mission saves through the existing connection. Other devices on that subnet can impersonate kiosks, so this arrangement assumes an isolated, trusted shop network.

**How to apply:** Do not reintroduce per-kiosk passwords for connected mission saves. Keep Denfi Points authoritative; never silently save a conflicting local mission if the central save fails. On multi-network Points hosts, scope automatic writes to the intended shop subnet. When both apps run on the same PC, connect via its private LAN address, not localhost: a reverse proxy must not bypass the network trust check. Internet or untrusted-network access needs real authentication and server identity verification, not only an HTTP connection.

Attendance rewards require live check-ins that Denfi Points times with its own clock. Offline kiosk progress is not replayed for points, even after reconnection; old local attendance files remain for compatibility but do not prove rewardable time.

**Why:** The user accepted losing genuine offline attendance rewards to prevent edited kiosk JSON from minting points. Trusting local cumulative seconds on reconnect defeated Points' authority.

**How to apply:** Only count bounded, near-continuous server-side intervals for the current day. Reject submitted seconds and past-day uploads; show attendance as paused when Points is unavailable. Do not restore offline replay without a new trusted proof mechanism.

Only Auto Shutdown's admin panel edits the shared attendance mission. Denfi Points shows the mission read-only while continuing to store attendance days and award points. A play-time range chooses one stable target for everyone each calendar day; equal minimum and maximum values give a fixed target.

**Why:** The user explicitly wanted Auto Shutdown to be the sole settings editor, without losing Denfi Points' global history and rewards. A daily shared target must not change on refresh or restart, or reward results and historical calendar goals would disagree. Relying only on yesterday's cached target also breaks the mission if the server is offline across midnight.

**How to apply:** Keep kiosk-initiated mission saves distinct from the Denfi Points admin panel; mirror the central range and daily-selection seed to kiosks. Apply the same daily target to every member, including during outages, but do not grant rewards for time Points could not observe live.

The active mission is play-time only; retain old login-day policies as history, but convert any active legacy login mission rather than awarding again on login. Preserve only the non-secret Denfi Points connection address outside Auto Shutdown's Windows install data so reinstalling the kiosk can reconnect and retrieve the central mission and already-synced member progress.

**Why:** A reinstall can replace kiosk-local settings and device identity without changing Denfi Points' authoritative member-day history. Keeping just the address outside the install avoids duplicating reward data while allowing reconnection.

**How to apply:** Keep Denfi Points as the source of rewards and attendance history. Never treat a kiosk's empty replacement data directory as evidence that a member has not completed today's mission. Do not duplicate or move reward records into the connection hint; disconnected time is not rewardable even if local seconds survive.