---
"@abide/abide": patch
---

a `ttl` of `Infinity`, or past the 2^31 - 1 ms `setTimeout` holds, no longer re-arms its timer every millisecond for the life of the value: `Infinity` arms none, and a longer `ttl` arms at the cap and re-arms from there
