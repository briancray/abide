---
"@abide/abide": patch
---

A followed value declaring a `key` is diffed in n log n rather than n² per production: a 10,000-row reorder sends its patch after 1.6 ms of diffing, where it took 83
