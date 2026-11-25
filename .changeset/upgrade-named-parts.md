---
"@abide/abide": minor
---

`abide upgrade --from 0.143.0` renames the parts 49.18 now names for their component — `talk.jump` to `talk.autoscroll.jump`, `steps.progress` to `steps.meter`, `crumbs.overflow` to `crumbs.menu`, `replay.speed` to `replay.toggleGroup`, `viewer.next` and every other member a lightbox laid flat from its carousel to `viewer.carousel.next` — where the name is bound to a `chat`, `wizard`, `breadcrumbs`, `playback` or `lightbox` call in the same file, leaving the same member read off anything else (38.221). What it cannot move by rote is left to the checker: `talk.draft` written or read as a string (it is a message now), the `{...talk.dropzone.host}` and `{...talk.autoscroll.host}` spreads a composer and a transcript now need, a job's `run` that read its argument as a signal (it reads `abortSignal()`), and a chart's `x` handed an index where its `x` option holds values.
