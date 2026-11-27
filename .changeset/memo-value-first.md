---
"@abide/abide": minor
---

`Memo` is typed `Memo<Value, Args, Failures, Produced>`, value first as `Rpc` is, and its call answers a `CallAnswer`: `Memo<undefined, JobStatus>` is now `Memo<JobStatus>`. A memo's `schema`, `args` and `transform` refusals are in its failures, so a derived `reactive` over a call and an `rpc` over the memo are typed with them, and `rpc` and `memo` take one `MemoOptions`
