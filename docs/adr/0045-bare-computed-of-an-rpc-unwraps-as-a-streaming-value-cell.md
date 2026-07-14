# ADR-0045: a bare `state.computed(getFoo())` unwraps as a streaming value cell; `await` only changes the SSR tier

**Status:** accepted (2026-07-14)

## Context

ADR-0042 established "await means resolved": `state.computed(await getFoo())` is a BLOCKING async cell — its `await` marker lowers to `computed(async () => await getFoo())`, which `createAsyncCell` unwraps to the resolved value, joining the SSR barrier so the value bakes into the first flush.

A bare `state.computed(getFoo())` — no `await` — went the other way. The type-directed seed classifier (ADR-0023) resolved `getFoo()`'s checker type to `promise` and, per the ADR-0019 D1 routing table, sent a `promise` seed to the **lazy `derive` slot**: an opaque `Computed<Promise<T>>` read as `foo()`. So `foo` was the raw Promise, and a template read `{foo?.messages}` read `.messages` off a *Promise* → always `undefined`.

The problem: **every example and doc uses the bare form as a reactive value read.** `const user = state.computed(getUser())` (cache recipe, "reactive, one line"), `state.computed(getRates(...))` (probes), and the same across `cookbook/routing/{layouts,routes}` and `reactive-state/reactions` — all read `foo?.field` expecting the resolved value. Under the ADR-0023 routing they silently rendered nothing (`—` / empty), and no cache reactivity (`invalidate`/`refresh`/`amend`, `watch`-driven) reached them because a lazy `derive` of a promise never re-resolves visibly. The bare-read authoring pattern the docs teach was broken framework-wide, only observable at runtime in a real browser (a hidden-tab automation harness masked it; ADR-0043's amend demo surfaced it).

The routing table treated `promise` and `sync` identically (both → lazy `derive`), reserving the eager async cell for `asyncIterable` (streams) and the explicit `await` marker. That left the no-`await` promise position — the exact case the docs demonstrate — with no unwrapping path.

## Decision

A type-directed **`promise`** seed in a bare `state.computed(getFoo())` now routes to a **streaming eager async cell**, the script-level twin of a bare async interpolation (ADR-0032). The compiler wraps it `async () => await (getFoo())` and emits `trackedComputed(async () => await (getFoo()), true)`:

- the `async`+`await` wrapper makes `createAsyncCell` **unwrap** the resolved value (a plain `() => getFoo()` thunk would fall to `trackedComputed`'s lazy path — its probe self-identifies only a stream, never a promise);
- the trailing `true` is `streaming`: with no author `await`, the cell does **not** join the SSR blocking barrier — the shell ships pending and the client resolves + reactively re-resolves.

So `getFoo()` and `await getFoo()` inside `state.computed(...)` now **differ only by SSR tier**, and both are unwrapped value cells read via `$$readCell`:

| form | SSR | client | `foo` reads as |
|---|---|---|---|
| `state.computed(getFoo())` | streaming — ships pending | resolves after hydration | the resolved value (`undefined` while pending) |
| `state.computed(await getFoo())` | blocking — value baked into HTML | warm, never pending | the resolved value |

This is the coherent completion of "await means resolved": `await` = resolved *in SSR* (block); bare = resolved *on the client* (stream). Both unwrap; neither is a `Promise`.

Mechanically: a new `isPromiseComputed` predicate (seed's checker type is `promise`, no `await` marker) is threaded through the name-collection pass and `computedStatements` alongside `isEagerStreamComputed`, so the binding lands in `cellReadNames` (read via `$$readCell`) on both client and SSR, and — carrying no author `await` — never joins `blockingCellNames`. Fail-open (no warm classifier) is unchanged: a bare call still routes through `isEagerStreamComputed`'s `isBareCallComputed` probe. An explicit thunk (`state.computed(() => getFoo())`) still stays lazy `derive`, and a `sync`-typed seed still stays `derive`.

## Consequences

- **The bare authoring pattern the docs teach works** — `{foo?.field}` renders and reactively updates (`invalidate`/`refresh`/`amend`, `watch`-driven). Verified in a real visible browser (Playwright, prod + dev, cross-tab) on both the ADR-0043 amend-broadcast demo and the unmodified reactions demo. No example needed editing.
- **`foo` is a reactive value cell in both forms, never a `Promise`.** This is a **breaking behavior change** relative to the old opaque routing: `state.computed(getFoo()).then(…)` and `await foo` (treating the binding as the fetch promise) no longer yield a thenable — `foo` is the unwrapped value (or `undefined` while pending). This was only ever meaningful under the removed opaque behavior; the asymmetry it relied on (bare = Promise, `await` = value) is gone. Replacements: `await getFoo()` directly for an imperative one-off (cached/coalesced, no extra fetch); `{#await getFoo()}` inline to render with an await block; `state.computed(() => getFoo())` (explicit thunk) if a genuinely opaque `Computed<Promise>` binding is wanted.
- **`{#await foo}` on a bare computed still works** — the await block reads the async-cell subject reactively (pending branch, then `{:then}` with the resolved value), so pre-declaring the cell and rendering it with an await block is unaffected.
- Supersedes the ADR-0019 D1 routing line "a bare promise seed is held opaque on the lazy derive." The ADR-0023 type-directed test that asserted that routing was updated to assert the streaming-cell routing.

## Alternatives considered

- **Require `await` to unwrap (leave bare opaque)** — keep `state.computed(getFoo())` a `Computed<Promise>` and sweep every example/doc to `state.computed(await getFoo())`. Preserves `foo.then`/`await foo` on the bare binding, but contradicts the docs' bare-read story, makes the common case verbose, and leaves a footgun (bare read silently renders nothing). Rejected: the bare read is the pattern the framework teaches, so it should be the one that works.
- **Blocking (not streaming) bare cell** — make bare join the SSR barrier like `await`. Rejected: it would erase the `await`-vs-bare distinction entirely and block the first flush on every bare read; streaming is the ADR-0032 "no-await value position" tier, so bare = stream keeps `await` meaningful (block) and the two orthogonal.
