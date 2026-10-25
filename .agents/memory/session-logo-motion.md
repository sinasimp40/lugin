---
name: Session logo motion
description: Keep the alternating balance-panel logo motion subtle and centered.
---

The owner disliked the logo's strong left-right movement in the session balance panel.

**Why:** After seeing the preview, they said “the left and right is too much its not good.”

**How to apply:** Keep the logo centered with a slow, restrained 3D tilt, not noticeable lateral travel or rocking. Use the same styling in preview and packaged Auto Shutdown.

The native session widget explicitly keeps its ghost movement and logo light sweep enabled even when Windows reports reduced motion; regular browser previews still respect reduced motion.

**Why:** The owner reported both effects missing after building the executable and requested that they remain visible. Both can otherwise be silently suppressed by the diskless Windows image's animation preference.

**How to apply:** Limit this motion opt-in to the native session renderer and these effects. Do not change Windows settings, other screens, or the subtle centered logo movement.
