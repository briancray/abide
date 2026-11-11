---
'@abide/harness': patch
---

`measuresNamed` returns `Trace['measures']`, so each measure carries its `name`; `shares()` no longer carries a runtime refusal for the withdrawn `within` option, which its type already refuses; the measure lane is built in memory for injection, and the `build:injectable` script is gone.
