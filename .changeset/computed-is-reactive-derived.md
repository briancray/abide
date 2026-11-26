---
"@abide/abide": minor
---

`computed` is `reactive.derived`: the value a body produces is a member of `reactive`, as `reactive.share` is, and the `computed` export is gone. `reactive.derived(() => …)` takes and does everything `computed(() => …)` did. `abide upgrade` spells every use of abide's `computed` as `reactive.derived` and imports `reactive` where a file did not (38.228).
