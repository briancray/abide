# ADR-0044: `watch(source, handler)` — the named source is the sole trigger; the handler is an untracked sink

**Status:** accepted (2026-07-14); implemented 2026-07-14. Refines the reaction semantics of `watch` (ADR-0041's unified reaction primitive) for the explicit-source forms. Independent of the recently-shipped `watch(cell.foo, …)` compile error, which rejects a member-access *source*; this ADR is about reads in the *handler body* of an otherwise-valid `watch`.

## Context

`watch` has five forms (`watch.ts`):

```
watch(thunk)                    // compiler binding — auto-tracked, == effect(thunk)
watch(cell, handler)            // a state cell
watch([a, b], handler)          // multiple cells
watch(socket, handler)          // a subscribable
watch(rpc, handler)             // an rpc (± args)
```

The two synchronous cell branches wrapped the handler directly inside the effect:

```js
return effect(() => { handler(cell.value) })          // single
return effect(() => { const v = cells.map(...); handler(v) })   // array
```

`effect` captures **every reactive cell read during its synchronous run** (`effect.ts:6-8`). So any reactive read *inside the handler body* silently became an extra trigger. A user writing

```js
watch(foo, () => { id = bar.id })
```

got a watch that re-ran on `foo` **and** on `bar.id` — the named source was not the whole story. The handler read is incidental; treating it as a subscription is surprising and defeats the point of naming a source. This is the "`watch(s.foo)` footgun" long noted for the diagnostic pipeline, in its subtler full-cell-source guise (the member-access guise is now a compile error).

Crucially, the other three branches **already** did the right thing:

- **subscribable** delegates to `cache.on`, which invokes the handler per frame, outside any tracking scope.
- **rpc** (`reactToRpc`) runs the handler in a `.then` microtask — after the effect's synchronous tracking window has closed.

So only the two cell branches leaked handler reads into the trigger set. The inconsistency, not the rule, was the anomaly.

## Decision

**For every explicit-source `watch(source, handler)` form, the named source(s) are the sole triggers and the handler runs untracked** — a reactive read in the handler body never becomes an accidental extra trigger.

Only the bare `watch(thunk)` form auto-tracks everything it reads. That is its defined job: it is the compiler's binding primitive (emitted as `$$watch(thunk)` for `{expr}` / `class:` / `bind:*`), where "re-run whenever anything I read changes" is exactly correct.

Implementation: read the cell(s) (the tracked triggers) first, then invoke the handler inside `untrack` (`runtime/untrack.ts`), which suspends the current observer for the synchronous body:

```js
// single cell
return effect(() => {
    const value = cell.value
    untrack(() => handler(value))
})
// array
return effect(() => {
    const values = cells.map((cell) => cell.value)
    untrack(() => handler(values))
})
```

The subscribable and rpc branches are unchanged — they already satisfy the contract.

`untrack` suspends only the *current* observer, so nested reactivity the handler itself creates (a nested `effect` / `watch` / interpolation) installs its own observer and is unaffected. Only *incidental* subscriptions in the handler's own body are dropped.

## Consequences

- **The mental model is one line:** name a source and only it triggers; name nothing (`watch(thunk)`) and everything you read triggers. There is no third case.
- **All explicit-source forms are now uniform** — the cell branches match the subscribable/rpc branches' pre-existing behavior rather than being a special case.
- **Breaking (semantic).** Code that relied on a handler-body read re-triggering the watch loses that trigger. That reliance *was* the footgun; the corrective form is explicit: watch the value you mean (`watch([foo, bar], …)`) or use the auto-track form (`watch(() => { id = bar.id; return … })`). Shipped as a minor with a changeset callout.

## Alternatives considered

- **Keep tracking the handler, warn at compile time.** Rejected: the surprise is a runtime trigger, not a syntax; a warning is easily lost in build output and does not fix the semantic. Naming a source should *mean* something.
- **A `watch(source, handler, { track: true })` opt-in to restore tracking.** Rejected as speculative — no demonstrated need, and it re-introduces the ambiguity this ADR removes. `watch(thunk)` already covers "track everything."
