---
"@abide/harness": minor
---

`allocated` is renamed `retainedPerRun`, for what it measures: the objects each run leaves reachable after a full collection, as a batch mean. `bun:jsc` counts survivors only, so it never saw what a run allocated and dropped (RULEBOOK 43.17)
