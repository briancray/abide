---
"@abide/abide": patch
---

The native app's notification permission request now asks for the badge too, so `navigator.setAppBadge` is drawn on the Dock once the person allows notifications (RULEBOOK 38.188, 38.190).
