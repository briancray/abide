---
"@abide/abide": minor
---

The server owns no `Reactive`: a handler declared over one throws at construction (16.109). A value the server writes is a handler's own — `GET(() => initial, { global: true })` written with `handler.set(args?, value)` and `handler.patch(args?, mutate)`, which every page following those args is sent — and a following browser's subscription builds the entry for its args where nothing has answered them yet (18.40). In a browser, `handler.patch` writes this page's copy, as an `offline` stand-in does. `job.status` and `pipe.status` are memos — `await digest.status()`, or `reactive.derived(() => digest.status())` on a page — and a job's status now carries `lastTook` and `lastResult`, the last good run's answer (54.41).
