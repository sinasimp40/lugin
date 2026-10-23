---
name: Mockup artifact registration
description: Legacy workspace failure during mockup-sandbox artifact registration and a non-invasive fallback.
---

Mockup-sandbox creation in this legacy Electron workspace has failed during service environment setup with `ARTIFACT_NOT_FOUND`; the platform then removes the artifact registration, although scaffold files remain. A different slug failed the same way.

**Why:** Repeated creation attempts did not produce a usable registered preview service. Migrating the working desktop app just to show theme options would exceed the user's design-only request.

**How to apply:** Check live artifact registration rather than assuming an existing scaffold directory means creation succeeded. If the same failure persists, use self-contained interactive HTML mockups extracted from the real session code, with live APIs blocked and original preview branches enabled. Explain the fallback and deliver the HTML through the asset library. Keep generated mockups out of Windows packaging; do not migrate the app without user approval.
