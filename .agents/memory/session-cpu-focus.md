---
name: Focus-dependent session CPU
description: Owner's Windows performance symptom and constraints for foreground monitoring.
---

The owner reported higher Auto Shutdown CPU usage when focusing other apps or using Alt+Tab, and lower usage after clicking the session view.

**Why:** This points to foreground-dependent native work as well as rendering; reducing animation quality alone is not an adequate diagnosis.

**How to apply:** Include session-focused and other-app-focused scenarios when checking Windows performance. Keep foreground monitoring lightweight and reusable, preserve fullscreen-bypass behavior and lock enforcement, and do not claim a CPU improvement from browser tests alone.
