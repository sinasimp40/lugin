---
name: Shutdown timer ownership
description: Safety rules for idle shutdown timing during renderer lag and startup session restoration.
---

The idle auto-shutdown deadline must be owned and enforced by Electron's main process. Renderer countdowns are display-only and must not be allowed to trigger shutdown before the main deadline.

**Why:** Image decoding, settings requests, or other renderer work can delay page timers. Startup hotspot restoration can also take several retries; starting the idle timer during that protected interval could shut down a valid paid session.

**How to apply:** Show and enforce the lock window immediately at startup, but keep a distinct restoration state with no idle deadline. Arm a new main-process deadline only after logged-out status is established, and issue the OS shutdown command before best-effort program cleanup.

After an explicit logout, the replacement lock-screen renderer must ignore any still-active hotspot response until it has observed a confirmed logged-out response.

**Why:** MikroTik can report the previous session for a few seconds after logout. Treating that response as session restoration makes the lock screen briefly appear and then reopen the old session.

**How to apply:** Distinguish explicit logout windows from ordinary startup windows and keep login polling in a logout-pending state until the hotspot first reports no active session.