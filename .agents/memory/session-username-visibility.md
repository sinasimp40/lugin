---
name: Session username visibility
description: The session bar must widen for the full username, including while other overlays are open.
---

The Auto Shutdown session bar must automatically widen to show the full member username, not rely on ellipsis or a hover tooltip.

**Why:** The owner repeated that long names still showed “mem ......” in the Windows executable after an earlier sizing fix.

**How to apply:** Verify the actual rendered text fits, not just the requested width calculation. Cover font loading, short-to-long session changes, open drawers, and the native window's applied bounds. Permit necessary growth while tools are open without repeated resizing or shrinking. Browser verification does not establish that an installed Windows executable contains the updated code.
