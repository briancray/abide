---
"@abide/abide": patch
---

`spreadAttrs` — swallow a per-key suspend on a `{...rest}` spread

A `{...rest}` spread guards its enumeration against a pending blocking `await` read, but not the per-key value read. When `source()` is a restProps proxy (the `<Button {...rest}>` case), its `get` invokes the underlying prop thunk, so a key whose expression reads a still-pending blocking cell suspends inside `bindKeys` — after the enumeration guard has already passed — and the `SuspenseSignal` escaped the render, killing the mount (seen as a crash on a cold client remount, e.g. navigating back to a page whose top-level blocking cells re-fetch and are briefly `pending()`). The per-key read now catches the suspend and binds the key as a deferred attribute (its `attr` effect swallows the signal and fills the value in on settle), matching `attr` and the deferred-enumeration branch; event handlers, whose thunks return a function without reading a cell, never suspend and stay on the listener path.
