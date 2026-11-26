---
"@abide/abide": minor
---

**Status belongs to Reactives only.** A handler (`GET`, `POST`, …) no longer has `busy()`, `ready()` or `synced()`, and the free `busy`, `ready`, `synced`, `refresh` and `invalidate` take one `Reactive`, `{ tags }`, or nothing — not a handler, and no pattern (13.1). A handler's call answers a promise, so to show its loading state read it inside a `computed` and ask that: `const won = computed(() => getStage({ stage: 'won' }))`, then `won.busy()`. A handler and a memo keep `refresh(pattern?)` and `invalidate(pattern?)` as methods: `refresh(getStage, { stage: 'won' })` is now `getStage.refresh({ stage: 'won' })`. A bare `busy()` is still true while the outbox sends a queued call (46.11), and `outbox(handler, pattern?)` takes a handler.

**A memo takes `schema`, `transform` and `identity`**, as `reactive` does (11.79), so `GET(fn, options)` and `GET(memo(fn, options))` take the same value options. A handler's `store` is typed as a memo's is, so `store.sqlite(db, 'calls')` and `store: ({ account }) => …` no longer need a type argument naming the value.

`Rpc.keyed` is removed.
