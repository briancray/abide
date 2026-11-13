---
'@abide/abide': patch
---

A job that `App.stop` stopped now stays stopped until an app opens again. A job is a `global` `reactive` declaring `poll` with no owner. Before this fix, a bare `refresh()` or a `refresh` over tags made after the stop reloaded a job whose body is a stream, because a stream is reloaded whether or not anything reads it. The job then ran with no app open, and the next `App.stop` waited on that run. Such a refresh now only invalidates the job (RULEBOOK 7.40). A later `App.stop` no longer probes a job, because that probe would run the reload the invalidation owes (RULEBOOK 7.42). A read made while the app is stopped still runs the job, but it no longer starts the job's `poll` clock. The clock waits for `App.listen` or `abide dev` (RULEBOOK 7.41).
