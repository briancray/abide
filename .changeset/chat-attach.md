---
"@abide/abide": minor
---

`chat` takes `attach`, deciding what a file is sent as (`assistantMessage`'s blocks by default, a throw turning it away, an empty list dropping it), and `accept`; any block can be attached, text included. `attaching` and the composer's `data-attaching` hold while a conversion runs, and a send meanwhile waits for it — 53.37, 53.106, 53.108
