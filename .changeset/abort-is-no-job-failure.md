---
'@abide/abide': patch
---

A job's run that gives up because the app is stopping — it throws the abort `stopSignal()` raised — is no longer warned on as a failure. `App.stop` used to log "a polled run failed" (or "a revalidation failed") on every stop for any job honoring `stopSignal`. The value goes on serving what it held, and `s.error` carries the abort until the next run lands. An abort is now recognised whichever `DOMException` raised it, so a test's DOM preload no longer hides the runtime's own.
