---
"@abide/abide": patch
---

a job's run is its own owner: it runs outside the request that called Job.run and the look that started it, so abortSignal() in it — and a worker call or a pipe defaulting to it — no longer ends as the caller hangs up or the next look starts, and does end at Job.stop — 54.35
