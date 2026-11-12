---
'@abide/abide': minor
---

`ABIDE_OFFLINE` is off unless the app's config or environment turns it on (`true`, or `1` / `true`
in any case) — an app that wants its pages kept offline now says so, `ABIDE_OFFLINE=1`. A browser that
installed the worker while it was on removes it on its next visit: the worker address answers the
worker that unregisters and empties every cache it kept, once and with no reload. RULEBOOK 45.14, 45.9.
