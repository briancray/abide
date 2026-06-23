---
"@abide/abide": patch
---

`on()` no longer attaches a non-function event handler. A component that omits an optional `on*` prop forwards it as `undefined`, yet the compiler still emits the `on()` call — so the listener fired `undefined(event)` and threw "handler is not a function" on every matching event (a keystroke or input on a search box, a click, …). `on()` now skips attaching when the handler is not a function, so an omitted optional handler is a no-op rather than a per-event crash.
