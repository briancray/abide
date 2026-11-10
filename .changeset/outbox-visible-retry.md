---
"@abide/abide": patch
---

The outbox restarts its retry wait from the floor when the page becomes visible, as the socket mux already did, so a queued write is retried promptly when a reader returns to the tab (46.8).
