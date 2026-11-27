---
"@abide/abide": minor
---

Every option a headless component binds takes a `Bindable` — any `{ get, set }` pair, which a `Reactive` is — so a pick can write somewhere other than one value (a filter moving the address, a choice saved through an `rpc`) without a derived value and a `watch` bridging the two (49.8)
