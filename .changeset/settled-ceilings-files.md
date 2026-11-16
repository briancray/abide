---
'@abide/abide': minor
'@abide/harness': minor
---

A test waits on `await settled()` from `@abide/harness/abide` (or `@abide/abide/test`) in place of `Bun.sleep` and a `flushSync()` loop: it resolves once no value is loading and no effect is pending, and past its `timeout` (2000 ms by default) it throws naming each value still loading, a handler's call by its method and address. Loads are kept for it only in a process that loaded `@abide/abide/test`. RULEBOOK 38.204, 38.205, 38.206.

`atMost(work, { wakes: 9, nodesCreated: 0 })` from `@abide/harness/gate` asserts ceilings on a work record, failing at the caller's line with every field over its ceiling and what it reported, and on a ceiling over a field the record carries as absent — an app's test holds the most it allows rather than an exact count of abide's internals. RULEBOOK 43.40, 43.41, 43.42.

The `@abide/harness/preload` DOM takes the `File` and `Blob` a test builds — `DataTransfer`, `<input type="file">`, `FileReader` and `URL.createObjectURL` accept them, and they still go over the wire as bun's — `new FormData(form)` carries the form's fields and files, and an `iframe` loads no page. RULEBOOK 43.28, 43.37, 43.38, 43.39.
