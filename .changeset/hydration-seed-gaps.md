---
'@abide/abide': patch
---

A GET called with `{}` is answered from its seed when the browser's call carries no query: an `Args` of no members keys as an absent one (11.24). A stream the server painted closed hydrates closed with its chunks rather than busy (41.26, 41.33), and a call painted in flight stays in flight until the page has hydrated, however early the browser made it (41.27). A build that stops on a refusal prints it as `abide check` does, not as a stack (38.139).
