---
name: Imported workspace versus upstream
description: Check live GitHub before treating absent local features as absent from the repository.
---

Distinguish this imported workspace from the current `sinasimp40/lugin` GitHub repository when checking feature availability.

**Why:** A local-only search incorrectly suggested Bingo was absent from the repository; the live upstream contained a registered Bingo service, admin controls, session UI, and tests that were missing locally.

**How to apply:** For questions about the GitHub repo, inspect its current branch tree and actual source, not just the workspace. Report local and upstream findings separately. Do not pull or merge upstream as part of a read-only check.
