---
"@abide/abide": minor
---

`amend` is now isomorphic like `invalidate`/`refresh` (ADR-0043): called on the client it mutates the local cache, but called on the **server** with a concrete value it broadcasts that value to every client reading the call — a push-refresh with zero refetches.

`amend` gains a value form alongside the updater form. The last argument may be a concrete `Return` (set it) or an updater `(current) => Return` (transform it); for a no-input rpc the args collapse (`getFoo.amend(value)`), matching how `fn()` vs `fn(args)` already read. From the server, only the value form broadcasts — an updater is a closure with no wire form and throws, and the value must target a keyed remote call (a producer/`{ tags }` selector throws). Delivery is confined to clients already reading that exact call (over a per-call reserved `__abide/amend/<key>` topic), so a pushed value reaches only readers already authorized for that key; a dropped frame heals on the next reconnect refresh. The updater form and client-side `amend` are unchanged.
