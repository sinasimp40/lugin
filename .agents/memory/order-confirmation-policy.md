---
name: Order confirmation policy
description: Operator Telegram handoff, private customer updates, shared-bot coordination, and native popup verification.
---

The owner requested a two-step order handoff on the same Telegram message: confirm the order to notify the ordering member that it is preparing, then mark it ready for pickup. Preparing has an X close button; closing preparing must not suppress the later ready notice. Speak the username without `mem-`, using the established offline Heart 1× voice.

The ready notice must play a repeating pickup beep after the voice. The customer must click **Order complete** to stop the sound and close the popup; ready no longer uses an X. Keep other ready orders' reminders active when completing one order. The test page must let the owner hear the voice and sound.

The test-page voice must speak the member's username without `mem-` in both preparing/received and pickup announcements. Showing the name in the card or generated speech text is not enough.

**Why:** The owner pointed out that the recorded test-page announcements omitted the username.

**Why:** The owner explicitly changed the ready notice from dismissible to an acknowledged pickup reminder.

**How to apply:** Treat successful completion as the shared served state, not a local dismissal. Keep the popup retryable if completion fails, and stop private reminders when the member leaves.

Announce “Your order is complete. Thank you [username]” using Heart 1× without `mem-`, in both the real kiosk and the test page.

**Why:** The owner asked for voice on Order complete, with the username.

**Why:** The owner wants to acknowledge orders from Telegram and notify the actual ordering customer without interrupting other members or sending another operator message.

**How to apply:** Keep notifications private to the originating PC and matching active member. Preserve per-order/per-stage deduplication, including dismissal and obsolete preparing speech. Keep an explicitly labeled local simulation that cannot send real Telegram orders.

Coordinate callback consumption for a shared Telegram bot rather than allowing each kiosk to independently consume its update queue. Denfi Points is the shared coordination authority, without receiving the Telegram bot credential.

**Why:** Telegram update offsets belong to the bot, not to a kiosk. Independent kiosk consumers can acknowledge and discard button clicks intended for another PC.

**How to apply:** Maintain a single elected consumer with a durable shared cursor and order-specific authorization. Retain failed message edits for retry without repeating the order transition or customer voice. Update both desktop applications when changing this contract.

Check new session notifications in the actual small native overlay geometry, not only a full-page preview.

**Why:** A full desktop-sized browser can show absolute-positioned cards that would be clipped by the compact Windows footer window.

**How to apply:** Verify expanded/collapsed heights and coexistence with drawers for top and bottom placement. Browser IPC emulation does not establish that Windows speakers or installer packaging work.

Order popups must match the full session-bar width, including the withdrawal icon when it is visible, and attach without a gap, like the other popups.

**Why:** The owner explicitly requested matching the session view with withdrawal and no spacing between the popup and session view.

**How to apply:** Keep this docking behavior for both preparing and ready states, above and below the bar, without changing voice or completion behavior.
