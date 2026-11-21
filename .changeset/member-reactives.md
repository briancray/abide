---
"@abide/abide": minor
---

Inside a `.abide`, a member typed as a `Reactive` is read and written by name as a name is: `ask.open ? 'yes' : 'no'` reads it and `ask.open = true` writes it, where both used to see the `Reactive` object. `route`'s five values are now one case of this rather than a list of their own. A `Reactive` assigned where none is yet — a `let` declared with none, a member a constructor sets, a new key — is bound to it rather than written into `undefined`; a read of an option that may hold no `Reactive` reads `undefined`; and `options.open ?? reactive(false)` keeps the `Reactive` where one is due. `dialog`'s `open` is optional and handed back, as `menu`'s is, so `ask.open = true` opens one (RULEBOOK 31.15, 31.19-31.21).
