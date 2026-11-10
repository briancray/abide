---
"@abide/abide": patch
---

A handler `timeout` longer than a timer can hold (2³¹−1 ms, about 25 days) no longer ends the load at once with a 504: the timer is capped rather than overflowing to 1 ms (16.59).
