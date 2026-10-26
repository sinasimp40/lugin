# Bingo Time — Auto Shutdown and Denfi Points

## Rollout

Rebuild and update **both** desktop apps, including every diskless Auto Shutdown
boot image. This adds Bingo to the existing Points SQLite database; it does not
replace balances or move the shop to another database. Back up the Points data
directory before installing an updated production build.

An older executable will not gain Bingo by changing a shared setting.

## Operator settings

Open **Auto Shutdown admin → BINGO GAME**. Connect to Denfi Points, then publish
the shared settings. Points stores and enforces them for all kiosks.

- Enable or disable new Bingo events.
- Allow custom card amount: when enabled, members choose a whole-number number
  of cards; when disabled, each member can buy exactly one card for one point.
- Joining window: 30–300 seconds.
- Draw interval: 3–30 seconds.
- Per-member card limit: 1–1,000 cards; total event capacity is 10,000 cards.

These settings are separate from wheel/dice custom stakes and daily play limits.
Changes apply to **new** events. A live event keeps its original rules.
The admin can cancel an unfinished event; accepted stakes are refunded once.

## Start from Telegram

Use the shop's existing Telegram bot and configured channel. The bot must receive
channel posts and have permission to edit channel messages.

Post **`/bingo`** in that channel. The elected kiosk Telegram consumer forwards the
command to Points. A recent command starts at most one event. Other chats, old
commands, and replayed updates must not start another event.

The existing command message is edited with the event state, full player names,
their bets/card counts, and all winners' actual point payouts. This shares the
existing Telegram consumer with order confirmations; do not run an independent
`getUpdates` consumer for Bingo.

No real Telegram message was sent while validating the integration.

## Player flow and payouts

- Members receive an invitation. Declining or insufficient points closes it.
- One point buys one random classic 75-ball card, with a free center.
- A complete row, column, or diagonal wins.
- All purchased cards appear together, with internal scrolling for large sets.
- Buying cards debits Points atomically; retrying the same entry cannot debit twice.
- At least **two distinct members** must join. Otherwise the event cancels and
  refunds all accepted entries before drawing.
- Every participant sees the same authoritative calls from Points.
- On a shared winning call, the entire pot is split **per winning card**. Two
  winning cards receive twice the share of one; rounding preserves the full pot.
- Every winner is announced, with points rather than a multiplier. Public winner
  notices and voice reach other and idle PCs too; draw speech is participant-only.
- A paid participant's popup remains open until completion or cancellation.
  Accepted cards restore from Points after reconnecting the same member.
- Session expiry, logout and shutdown remain authoritative. Other members must
  never see the previous member's cards.
- Active participants' funding logs cannot be deleted before cancellation/refund.
