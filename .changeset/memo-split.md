---
"@abide/abide": minor
---

A value computed by a body is a `memo`: `memo(() => seats * price)`, `memo(({ id }) => getDeal({ id }))`, `memo(async function* () { … })`. `reactive` holds a value and only a value — a function handed to it is held, not run — and `memo` handed anything but a body throws where it is written. Both hand back the same `Reactive`. `abide upgrade` renames every `reactive` handed a body to `memo` and imports it.

Inside a `memo` body, `stopSignal()` is that run's own signal: aborted when the next run replaces it, when the value is released, and when the app stops — so a fetch a keystroke made obsolete stops rather than finishing for nobody.
