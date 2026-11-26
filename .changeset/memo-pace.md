---
"@abide/abide": minor
---

`memo` and handlers take `throttle` and `debounce`: a key reached anew is held back as before (5.19), and each entry is paced too, its owner's `set` and `patch` included, so every follower is sent at most one value per window and always the last (5.25). Pacing is the source's — the copies every follower is sent — which a reader's own pacing could not hold back (16.110).
