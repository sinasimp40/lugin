---
name: Betting policy compatibility across desktop builds
description: Why a successful betting-policy write alone is not proof that Denfi Points is using the new spin and stake settings.
---

Treat a betting policy as live only after checking that Denfi Points supports its spin-limit and custom-stake fields and reading the persisted policy back.

**Why:** Older Denfi Points executables can acknowledge a request while discarding newer policy fields, leaving the live game at one spin per day and full-balance staking. An Auto Shutdown executable can be newer than the separate Denfi Points executable.

**How to apply:** Check the remote capability before writing, reject old builds without a partial odds update, and compare the complete policy after writing. Keep offline drafts clearly separate from the active Denfi Points policy; connection alone does not publish a draft.