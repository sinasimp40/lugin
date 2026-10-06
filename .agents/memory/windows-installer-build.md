---
name: Windows installer build environment
description: A Linux workspace quirk when producing the Denfi Points NSIS installer.
---

The workspace cannot currently complete NSIS installer finalization. Its default Wine launcher fails; wine64 responds to a version check. electron-builder supports USE_SYSTEM_WINE=true, and a temporary PATH shim can correctly redirect wine to wine64, but executing the generated NSIS executable still fails. Redirecting the launcher alone does not fix the environment.

**Why:** Electron packaging succeeds, but installer finalization has failed with signing/resource editing disabled and with the verified wine64 redirection. Treat any resulting Setup.exe as incomplete rather than offering it to a user.

**How to apply:** Verify installer completion on a working Windows or Wine environment and smoke-test installation plus data retention before calling it ready to install. A complete Windows unpacked-app ZIP can be an honest fallback: it contains a runnable exe and required companions, not an installer. Validate packaged sources and exclude settings/data. Do not substitute a self-extracting portable exe without checking persistent data paths; these apps keep operational data adjacent to their running executable.

Full Windows Electron app ZIPs exceed the observed 100 MiB asset-upload limit. Deliver matching ordinary ZIP parts below the limit when a full archive cannot be attached; bundled speech models can require more than two parts.

**Why:** A complete app archive was rejected as TOO_LARGE; splitting preserves Windows' normal ZIP extraction support without using a temporary self-extracting executable.

**How to apply:** Verify all parts collectively contain the full app, and tell the owner to extract all matching parts into the same folder. Never offer the exe-only part as a standalone application.

Cross-building native audio from Linux needs explicit Windows dependency checks; successful Electron packaging is not proof the speech engine can import on Windows. Platform-specific optional dependencies can be omitted on Linux even when a parent audio library imports them indirectly.

**Why:** The audio stack imports a native image dependency during initialization even though speech does not use images. A missing Windows binding stops voice before inference, while the kiosk itself still starts.

**How to apply:** Inspect the full target-platform dependency chain and native DLLs, preserve upstream licenses, and verify actual Windows startup separately. Do not silently bundle Microsoft runtime DLLs without establishing redistribution rights; provide the official one-time runtime prerequisite and a clear failure warning instead.

CPU-only speech packages can omit browser-only AI runtime assets, but must not globally remove WebAssembly files: the speech phonemizer itself needs WebAssembly.

**Why:** The model library's source mentions both browser and native backends, but its bundled Node export ignores the browser backend. The phonemizer is a separate, required runtime.

**How to apply:** After trimming dependencies or upgrading their versions, test real offline generation using the pruned package. Substituting Linux native bindings proves dependency pruning, not Windows startup or speaker playback.