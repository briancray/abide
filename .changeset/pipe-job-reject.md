---
"@abide/abide": minor
---

A pipe call and `Job.run` reject with a refusal, as a handler's call does: `await rename('d2')` hands back the last step's answer, and a step's refusal — returned, or rejected by a handler called as a step — ends the item and rejects the call, still read for transience and retried where it is worth asking again (57.5). `Job.run` rejects with what its run threw or refused; the status keeps `lastError`, and a run its schedule started is logged as before (54.39). A pipe's `readable` still hands a refused item on as its refusal.
