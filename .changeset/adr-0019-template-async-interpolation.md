---
"@abide/abide": minor
---

Async template interpolation — `{await foo()}`, `{foo()}`, `{getStream()}` (ADR-0019 follow-up)

A template interpolation now understands async expressions, chosen by the expression's type (resolved through the shadow TypeChecker at build time — zero runtime cost, dev/prod consistent):

- `{await foo()}` — awaits the promise, **blocking** (bakes into the SSR HTML). Syntactic; desugars to a blocking `{#await … then}` block.
- `{foo()}` where `foo()` is a `Promise<T>` — **streaming** (real Tier-3 out-of-order SSR); desugars to a streaming `{#await}` block.
- `{getStream()}` where the expression is any `AsyncIterable<T>` (a socket, a streaming rpc, or a plain async generator) — renders the **latest frame**, live, as a stream cell.
- A `Promise`/`AsyncIterable` in a value slot that can't be rendered (an attribute, an `{#if}`/`{#switch}` head, a sync `{#each}` iterable) is a **compile error** with a hint, never a silent `[object Promise]`. `{#for await}` stays the sanctioned async-iterable position.

Errors compose with `{#try}`: a catch-less `{#await}` / `{#for await}` (and these new bare forms) now bubbles a rejection to the nearest enclosing `{#try}` instead of an unhandled rejection.

The type-directed lowering fails open to a plain read on any type-resolution hiccup, so it can never break a build; a component with no async interpolations is unaffected.
