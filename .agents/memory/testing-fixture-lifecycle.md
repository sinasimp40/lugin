---
name: Testing fixture lifecycle
description: Temporary HTTP fixture processes need an explicitly managed lifetime across browser-testing tool calls.
---

Detached fixture servers started inside a testing agent's shell may stop between tool calls.

**Why:** Valid temporary Node servers became unreachable between browser calls; keeping the server in the main agent's managed background task allowed the same browser check to complete.

**How to apply:** Give temporary test servers an explicitly managed lifetime across browser calls, and clean them up after the check. Do not mistake a terminated fixture process for an application failure.

Browser workers may not reach an arbitrary localhost port even when the main
agent can. Prefer an isolated fixture in the managed preview, addressed through
the development preview URL, when checking a multi-client flow.

**Why:** A live fixture was reachable from the main shell but refused connections
from the browser worker; the same fixture worked through the managed preview.

**How to apply:** Restore the normal workflow afterward. For time-limited game
flows, use a longer allowed joining window in the fake fixture so tool latency
does not consume the whole event; do not alter production timing defaults.