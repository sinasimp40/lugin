---
name: Windows installer build environment
description: A Linux workspace quirk when producing the Denfi Points NSIS installer.
---

The workspace's Wine executable is 32-bit and fails with a shell syntax error when electron-builder attempts to run the generated NSIS executable. Its 64-bit Wine executable responds normally to a version check, but the NSIS build path still invokes the broken 32-bit one. This can leave a partially built installer and a Windows unpacked folder; neither is proof of a finished or tested installer.

**Why:** Electron packaging succeeded, then installer finalization failed twice in this Nix environment, including with executable signing/resource editing disabled. Treat any resulting installer as incomplete rather than offering it to a user.

**How to apply:** When preparing a Windows release, verify the installer build completes on a working Windows or Wine environment and smoke-test installation plus first-run data import before telling the user it is ready to install.