---
"@abide/abide": patch
---

`for await` over a streaming `reactive.derived` or `memo` entry opened while a refresh's run is in flight walks that run, from its first chunk to its close, instead of the closed run a read still serves meanwhile (9.18).
