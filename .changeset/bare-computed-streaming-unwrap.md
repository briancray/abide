---
"@abide/abide": minor
---

A bare `state.computed(getFoo())` over an rpc now unwraps to the resolved value, so `{foo?.field}` renders and reactively updates — the pattern the docs and examples already teach.

Previously a no-`await` `state.computed(getFoo())` was classified as an opaque `Computed<Promise>` (ADR-0023 routing), so a template read like `{foo?.messages}` read `.messages` off a Promise and always showed `undefined`, with no cache reactivity reaching it. Now `getFoo()` and `await getFoo()` inside `state.computed(...)` differ only by SSR tier and are both unwrapped value cells (ADR-0045):

- `state.computed(getFoo())` — **streaming**: SSR ships the pending branch, the client resolves after hydration.
- `state.computed(await getFoo())` — **blocking**: SSR waits and bakes the value into the HTML (warm hydrate, never pending).

**Breaking behavior change:** `foo` is now a reactive value cell in both forms, never a `Promise`. Code that treated the bare binding as a thenable — `state.computed(getFoo()).then(…)` or `await foo` — no longer gets the fetch promise (it gets the unwrapped value, or `undefined` while pending). For an imperative one-off, call `await getFoo()` directly (cached/coalesced); to render with an await block use `{#await getFoo()}` inline; for a genuinely opaque `Computed<Promise>` binding use an explicit thunk, `state.computed(() => getFoo())`. `{#await foo}` on a bare computed still works (it reads the async-cell subject reactively).
