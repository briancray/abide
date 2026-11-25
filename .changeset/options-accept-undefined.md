---
"@abide/abide": patch
"@abide/harness": patch
---

Every option's type accepts `undefined`, so an app under `exactOptionalPropertyTypes` can hand on an option it may not have, and an option given `undefined` is read as one not given (59.1, 59.2). A `POST` given `ttl: undefined` keeps its `ttl` of 0, and a number formatter given an option as `undefined` keeps abide's default for it.
