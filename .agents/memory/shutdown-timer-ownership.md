---
name: Shutdown timer ownership
description: Safety rules for idle shutdown timing during renderer lag and startup session restoration.
---

The idle auto-shutdown deadline must be owned and enforced by Electron's main process. Renderer countdowns are display-only and must not be allowed to trigger shutdown before the main deadline.

**Why:** Image decoding, settings requests, or other renderer work can delay page timers. Startup hotspot restoration can also take several retries; starting the idle timer during that protected interval could shut down a valid paid session.

**How to apply:** Show and enforce the lock window immediately at startup, but keep a distinct restoration state with no idle deadline. Arm a new main-process deadline only after logged-out status is established, and issue the OS shutdown command before best-effort program cleanup.