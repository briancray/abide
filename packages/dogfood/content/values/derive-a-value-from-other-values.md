---
title: Derive a value from other values
nav: Derived values
intent: Compute something from what you already have, and recompute it only when the inputs move.
covers:
  - `memo`
  - `Memo`
  - `memo` body, unkeyed
---

A word count is a function of the draft. A total is a function of the rows. Writing either of
them down twice — once as the computation and once as the list of things that should re-run it —
is where derived values go stale.

```abide #ui/pages/editor/page.abide
<script>
import { state, memo } from 'abide'

const draft = state('')
const words = memo(() => draft.trim().split(/\s+/).filter(Boolean).length)
</script>

<textarea bind:value={draft}></textarea>
<p>{words} words</p>
```

*1 declaration, 0 dependency lists* — against the computation written once and its inputs
written again beside it.

You never register anything. The body read `draft`, so `draft` is what re-runs it.

## What re-runs a memo

Whatever the body **read** on its last run — that is the whole dependency graph. Reading is what
subscribes, so the graph is discovered rather than declared, and it can change from one run to
the next without anything being kept in step.

```abide abide
const rows = state<Row[]>([])
const showPaid = state(false)
const visible = memo(() => showPaid ? rows : rows.filter((row) => !row.paid))
```

When `showPaid` is true the body never touches `row.paid`, and nothing about that has to be
declared either.

## A memo is a `Reactive`, not a wrapper

An unkeyed `memo` **is** a `Reactive`. It is not a box you unwrap and it has no members of its
own, which is what makes all of this read the same as a state:

```abide abide
<p>{words / 2} lines, about</p>
{#if visible.refreshing()}<span>Recounting…</span>{/if}
```

`words / 2` is a read by name and `visible.refreshing()` is the ordinary probe — the same two
spellings a `state` gets.

There is one `set` in the design and it is `Reactive`'s, so writing to an unkeyed memo is the
member the type already declares.

## An async body is a load, not a promise

A memo body may be async, and what is held is the **settled** type — `memo(async () =>
rollUp(rows))` is a `Reactive<Rollup>`, never a `Reactive<Promise<Rollup>>`. That is `state`'s own
rule reaching the other producers, so the probes work out the same: `pending()` while the first
run is in flight, `refreshing()` over a value still being served.

A body that returns another `Reactive` is **adopted**: the outer subscribes to the inner, mirrors
its productions into its own ring and forwards its probes and triggers. That is what makes the
wrapper around an rpc call load-bearing rather than ceremony —

```abide abide
const invoice = memo(() => getInvoice({ id: route.params.id }))
```

— because a `<script>` setup body is untracked, so the call alone would register nothing and the
value would never follow `route.params.id`. The outer memo is what makes the call reactive to its
arguments. Without adoption you would also be holding a `Reactive<Reactive<Invoice>>`, and
`invoice.total` would reach the wrapper rather than the row.

Adoption is an identity cutoff too: a recompute that lands on the **same** inner value wakes
nobody, and an args key that hits a live entry adopts synchronously — so re-filtering back to a
key already held never flashes a spinner, not for a microtask.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Caching](load-once-per-set-of-arguments.md)

## Transforming an adopted value

An inline expression cannot reshape an adopted value, because reading the `Reactive` to reshape
it is exactly what loses the adoption. `transform` runs **after** adoption, on the settled
payload:

```ts shared
memo(() => new Set(getUsers(args).map((user) => user.id)))            // reads it → adoption LOST
memo(() => getUsers(args), { transform: (users) => new Set(users.map((user) => user.id)) })
```

## Writing to a memo

A memo is writable, and a write stands until the next recompute clobbers it. On an unkeyed memo
that means it survives until something the body read moves — which is one primitive rather than
two:

```abide abide
const editable = memo(() => structuredClone(upstream))
```

That is a local draft re-seeded from its source. Type into it and the edits stand; when
`upstream` lands a new row, the draft is rebuilt from it.

There is no warning on that write, and there could not be a useful one: `memo(() =>
structuredClone(upstream))` and `memo(() => a + b)` are indistinguishable to a compiler, so a
warning would fire hardest on the good pattern.

A write of a settled value is not a load — `success()` stays true, `refreshing()` stays false. A
write of an unsettled one **is** a load and moves the probes the way any load does.

## Keyed memos are a different shape

The discriminant is syntax: the body's parameter.

| You write | You get |
| --- | --- |
| `memo(() => …)` | a `Reactive` — **tracked**, recomputing when what it read changes |
| `memo((args) => …)` | a `Memo` — a factory, **untracked**, one entry per args key |

A `Memo` is `(args) => Reactive` with `invalidate` and `refresh` on it, the factory being what has
an args space to narrow over. So the probes live on the invoked result — `getInvoice({
id }).pending()` — and there is no `getInvoice.pending()` to reach for.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Reloading](decide-when-a-value-reloads.md)

## A read after an `await` registers nothing

Tracking is synchronous. A body suspends at its first `await` and the subscriber is restored, so
a reactive read in the continuation subscribes to nothing — reliably nothing, which is why the
compiler **warns** and names the read rather than leaving you a memo that is correct once and
stale forever.

```ts shared
memo(async () => {
    const rate = await getRate()
    return rate * amount()   // warns: `amount` is read after an await
})
```

Two repairs, and the first is also the faster shape: hoist the read above the `await`, or say
`peek()` where the read was meant to be untracked.

Read on: [Reloading](decide-when-a-value-reloads.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — one entry per set of arguments
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — when the inputs move too fast
* [Watching values](do-something-when-a-value-changes.md) — for effects, where a memo is for values
