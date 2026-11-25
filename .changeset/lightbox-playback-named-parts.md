---
"@abide/abide": minor
---

Breaking: `lightbox`'s carousel is `carousel` — its `host`, `item`, `previous`, `next`, `play`, `playing`, `current`, `selected`, `scrollTo`, `reset` and `id` handed back whole under its name rather than laid flat beside the dialog's parts (49.18, 50.65) — and `playback`'s `speed` is `toggleGroup` (49.18, 51.134). `abide upgrade --from 0.143.0` moves both where the name is bound to a `lightbox` or `playback` call (38.221).
