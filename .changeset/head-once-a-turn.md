---
"@abide/abide": patch
---

Rows that each contribute to the document `<head>` reconcile it once a turn rather than once per row, so growing a list of 1,600 such rows no longer costs hundreds of milliseconds. And equal keyless head contributions from rows mounted together each keep a node of their own, rather than two rows adopting one (39.16).
