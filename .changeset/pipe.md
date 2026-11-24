---
"@abide/abide": minor
---

`pipe(steps, options)` runs each item through steps in order — a list in the steps is one step whose members run at once on the same input, and a step that yields hands each chunk on as an item of its own. At most `concurrency` items run at once (one where none is given), counted per `key` where one is given, and a pipe used as a step of others is one budget for all of them. Each step's attempt is retried up to `retries`, spaced by `backoff`, ended at `timeout`, and a `Retry-After` holds the step for every item. `paused` holds new attempts while it reads true; `stop()` ends the pipe. A pipe is a function to call and a `readable` / `writable` pair to `pipeThrough`, with its `status` as one `Reactive`. A pipe called in a `memo` body is told when the run is superseded.

`fetchJson` and `fetchText` take `backoff`: the first wait, doubled per retry, or a function naming each wait. `job` takes `paused`, and a job's run is no longer aborted by the look after it where it overruns under `from: 'start'`.
