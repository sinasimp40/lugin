---
name: Cash withdrawal rules
description: Owner-confirmed conversion and central-control requirements for physical cash withdrawals.
---

One point equals ₱1. Withdrawals must be whole numbers; fractional points stay in the member's balance.

**Why:** The owner explicitly confirmed the one-to-one conversion and requested no decimal withdrawals.

**How to apply:** Do not round a fractional balance into additional cash or change the conversion without asking the owner.

The operator configures withdrawals in Auto Shutdown, but Denfi Points is the shared authority for enabling/disabling and minimum/maximum amounts across all PCs. Use the existing Telegram bot/channel for complete withdrawal status reports.

**Why:** The owner wants a single saved setting to automatically control every PC, and reports containing the member, amount, date, time, and result.

**How to apply:** Do not introduce independent per-PC payout policies or distribute Pisonet passwords to player sessions.

Withdrawal management on connected PCs must use only the existing Auto Shutdown admin login, without a second Denfi Points admin password.

**Why:** The owner said "all PC is authorized once it connected to denfi points" and explicitly selected Auto Shutdown admin login only.

**How to apply:** Keep operator/member access separate and all payout settings central, but do not restore an additional Points password prompt. Trust connected kiosk servers under the shop LAN policy; keep upstream credentials server-only and require the kiosk's local admin login for management.

Withdrawal administration must work over the existing outbound Auto Shutdown-to-Points connection, without requiring Points to connect back to each kiosk.

**Why:** The owner reported Runtime correctly showing connected while the added reverse admin-session check prevented withdrawal configuration. Outbound connectivity does not imply that Windows permits inbound connections.

**How to apply:** Do not add reverse-network login verification as a prerequisite for shared settings or reconciliation. Test management with reverse connections blocked and keep the local admin gate intact.

The owner uses a diskless setup: withdrawal configuration works on the server, while other PCs use the diskless deployment.

**Why:** The owner explicitly repeated this after source-only fixes left clients showing the removed reverse-check error.

**How to apply:** Treat source edits as distinct from updating the running Points server and the persistent shared client image. Do not assume a change saved on an individual diskless PC survives reboot. Check the running server's capability rather than concluding that a working Runtime connection proves its withdrawal module is current.

Use the owner's supplied controller as the reference before changing dispenser authentication or token handling.

**Why:** The owner corrected the implementation after a real login-token failure and specifically asked whether the supplied code's token flow had been read.

**How to apply:** Check the controller's actual authentication flow first. Do not assume that a working controller obtains a fresh token on every operation, or claim that fake-response tests establish compatibility with its live login response.

The owner confirmed the working controller uses username/password login.

**Why:** The owner explicitly selected username/password login when asked which authentication method works.

**How to apply:** Keep that as the dispenser authentication method. Do not replace it with a manually supplied bearer-token requirement unless the owner asks.

An uncertain physical coin release must be checked by an operator, not automatically retried or refunded.

**Why:** The supplied controller sends only an amount to the dispenser, without a withdrawal identity that the dispenser could use to reject duplicate releases. Retrying a lost response could pay twice; refunding it could give away already-paid cash.

**How to apply:** Preserve held funds and the original request identity on ambiguous responses or restarts. Require an authenticated operator decision about whether cash was actually paid.

Use one-at-a-time withdrawals with an explicit later submission, rather than an automatically executing cash queue.

**Why:** A delayed queued payout could execute after the member leaves the PC. The owner asked for clear handling when multiple PCs request cash at the same time.

**How to apply:** Display the shared busy/paused condition, do not charge waiting members, and require a fresh intentional submission once the machine is available. Uncertain payouts continue to block all PCs until an operator checks them.

Use a shared 10-second cooldown after a confirmed payout, not a separate wait per member or PC. Definite login failures do not need that post-payout wait.

**Why:** The owner requested a visible 10-second countdown when discussing simultaneous withdrawals from multiple PCs. A per-PC timer would let another PC bypass the wait for the same physical machine.

**How to apply:** Points enforces the wait for all connected PCs, including after a restart. The countdown is informational: its expiry must never automatically submit a waiting amount or remove an uncertain-payout hold.

The daily withdrawal setting is a configurable count of successful withdrawals per member, not a peso allowance or a shop-wide/PC limit. The owner clarified: "it depend on how much widrawal allow per user per day i put."

**Why:** The owner selected a per-member limit and explicitly corrected the assumption that it must always be once per day.

**How to apply:** A limit of 1 allows one successful payout of any permitted amount; 3 allows three. Enforce centrally so changing PCs or retrying a request cannot add allowance. Failed attempts do not consume it. Count PAID reconciliation on its confirmation day.

Use midnight UTC+8 for the withdrawal calendar-day reset, with 0 meaning no daily limit for backward-compatible existing settings. A daily reset grants allowance only; it does not erase history, restore spent points, or remove uncertain-payout holds.

**Why:** The cash workflow already uses the Philippine UTC+8 calendar, and host-local midnight would change when Points moves between machines. Existing installations must not suddenly become restricted during an update.

**How to apply:** Label the reset timezone and unlimited value in the admin UI. Recheck live limits immediately before dispatch. Preserve an active daily limit when older admin clients omit it, and require explicit Points capability/readback before claiming a new limit was published.

Withdrawal station identity must come from the active hotspot IP-to-unit mapping used by the session display, not the saved unit name. If the mapping is unavailable, report Unknown PC (with a valid IP when available).

**Why:** The owner reported a member on PC 10 appearing as PC 1 in both Telegram and history. The saved default PC 1 can be copied across a diskless image and is not detected identity.

**How to apply:** Derive member and station together from the authenticated live session on the kiosk server; do not trust a browser-supplied station or silently label an unidentified machine PC 1. Keep existing financial records intact rather than guessing historical station corrections.