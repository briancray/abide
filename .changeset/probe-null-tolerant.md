---
"@abide/abide": patch
---

`done()` / `peek()` are null-tolerant, so a probe fed a pending peek-lift no longer 500s

Under ADR-0032 a promise/iterable subexpression peek-lifts to `undefined` while pending, so writing a probe inline in a template — `{done(getFeed())}` / `{peek(getFeed())}` — hands the probe `undefined` on the first render pass. `done()` now returns `false` and `peek()` returns `undefined` on a nullish argument instead of throwing on `subscribable.name`, turning that pending render from an SSR 500 into a graceful empty state. Probing in script (`const closed = state.computed(() => done(feed))`) remains the correct idiom for an accurate stream probe, since a lifted `AsyncIterable` peek yields the latest frame, not the source.
