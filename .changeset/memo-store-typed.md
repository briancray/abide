---
"@abide/abide": patch
---

A `memo`'s and a handler's `store` takes a `Store<T>` typed by the value it keeps, beside an untyped one such as `store.sqlite(db, 'calls')`; a store of another value is refused (11.78, 16.110).
