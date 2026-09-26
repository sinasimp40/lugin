---
name: Session visibility reliability
description: Rules that prevent transient hotspot data and stale asynchronous callbacks from removing an active session overlay.
---

Do not treat one unauthenticated hotspot sample as a definitive logout. Require multiple consecutive valid samples before broadcasting an automatic logout; explicit user logout remains immediate.

**Why:** A transient MikroTik response can briefly report no login during an active paid session, causing the session overlay to disappear.

**How to apply:** Preserve the last confirmed active session during tentative samples and reset the confirmation count whenever an authenticated sample returns.

Electron polling and foreground checks must be owned by the current session generation and window.

**Why:** Callbacks from a stopped poll or replaced window can arrive later and hide or transition a newer session.

**How to apply:** Cancel old requests, reject callbacks that no longer own the active request/window, and exact-match normalized foreground process names before intentionally hiding the overlay.

While a drawer is open, avoid shrinking the transparent Windows session window in response to changing content or periodically updated points within that drawer. Reserve space for predictable controls such as betting confirmation. Reset the size floor when switching to a different drawer.

**Why:** Windows repaints transparent Electron windows when their bounds change; repeated resize requests can look like the whole popup is flickering even when the DOM remains mounted. But carrying a tall game's size floor into a shorter Order, Ranking, or Attendance panel leaves a large empty window.

**How to apply:** Prefer stable bounds during interactions; allow growth only when new content truly needs more room, and measure afresh on a panel switch or close. Browser previews cannot verify the actual Windows compositor behavior.