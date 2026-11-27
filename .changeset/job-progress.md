---
'@abide/abide': minor
---

A `job`'s run is handed, beside its input, a `progress` function writing how far it has got into `JobStatus.progress` — `undefined` while no run is going — and a `job` takes `throttle` to pace its status writes as a `memo`'s owner is paced (54.42, 54.43).
