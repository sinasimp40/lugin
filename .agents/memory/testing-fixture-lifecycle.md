---
name: Testing fixture lifecycle
description: Temporary HTTP fixture processes need an explicitly managed lifetime across browser-testing tool calls.
---

Detached fixture servers started inside a testing agent's shell may stop between tool calls.

**Why:** Valid temporary Node servers became unreachable between browser calls; keeping the server in the main agent's managed background task allowed the same browser check to complete.

**How to apply:** Give temporary test servers an explicitly managed lifetime across browser calls, and clean them up after the check. Do not mistake a terminated fixture process for an application failure.