---
name: Telegram duplicate prevention
description: The owner's no-duplicate priority and the delivery uncertainty tradeoff.
---

Prefer pausing an uncertain Telegram send over automatically posting it again. Keep the original event identity across PCs, restarts, and receipt retries. Do not clear or expire a dispatch guard merely because a lease timed out.

**Why:** The owner showed two Telegram messages with the same order ID and requested that orders, betting, withdrawals, and other notifications not be sent twice. Telegram may accept a message before its HTTP response is lost; automatic retry cannot guarantee duplicate-free delivery.

**How to apply:** Retry only proven non-acceptance. Preserve confirmed message receipts and repair their bookkeeping without repeating sendMessage. Keep uncertain deliveries visible for operator review; never describe them as delivered or silently discard the guard. Distinct withdrawal status updates are distinct events, not duplicate payouts or duplicate copies of one status.

All participating Auto Shutdown kiosks and Denfi Points must be updated together for shared protection. The coordinator receives delivery metadata, not the Telegram bot credential.

**Why:** Older desktop executables can bypass the shared safeguard.
