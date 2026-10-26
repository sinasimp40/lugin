---
name: Source-focused workspace cleanup
description: Why completed demo files were removed and what disk cleanup must preserve.
---

Keep the working source and required runtime resources. Completed standalone demonstration pages, generated sample recordings, screenshots, old build ZIPs, and installer-download caches are disposable.

**Why:** The owner said “we only need the source” when requesting cleanup of an oversized workspace after verifying the app.

**How to apply:** Distinguish standalone demonstrations from the HTML screens used by Electron, including the session screen and background voice player. Preserve offline voice resources, saved data, uploaded database backups, and small automated source tests. Do not remove installed dependencies or project history merely to reach a storage target without explaining the resulting loss of runtime/build capability or recovery history.

The owner reiterated that only files needed to build the Windows EXEs should be kept for GitHub, and requested file deletion rather than another archive deliverable.

**Why:** The owner plans to upload the source to GitHub and found the local project storage too large.

**How to apply:** Keep build-irrelevant platform binaries and generated/reference/private files out of the published source. For first GitHub publication, import current source files into a fresh repository: the existing local history includes older private runtime data and generated binaries. Ignore rules and removing files from the current index do not sanitize old commits. Keep the current offline voice model and its Git LFS rule.

The owner explicitly requires only the roughly 93 MB source for GitHub and approved removal of installed dependencies, local app data, caches, and old Git history after being told that the preview would stop and local records/history would be lost.

**Why:** The owner said “i only need 93mb” and confirmed the source-only cleanup.

**How to apply:** Treat the deliverable as source plus required offline voice resources, not a running installation or generated ZIP. Restore dependencies with `npm ci` when a requested run or build needs them. The approval concerned the cleanup of existing local data, not permission to erase future records.

That earlier destructive cleanup approval is not standing permission to remove
dependencies or records from a subsequently restored, working installation.

**Why:** Later cleanup requests followed the owner asking to get the preview
running again. Removing regenerated builds and mockups need not stop the app.

**How to apply:** Report the source-and-runtime-assets size separately from
installed dependencies and local recovery history. Keep the working preview
unless the owner explicitly accepts a source-only workspace that cannot run
until dependencies are reinstalled.
