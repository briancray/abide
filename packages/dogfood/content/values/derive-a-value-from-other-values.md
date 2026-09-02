---
title: Derive a value from other values
nav: Derived values
intent: Compute something from what you already have, and recompute it only when the inputs move.
covers:
  - `memo`
  - `Memo`
  - `memo` body, unkeyed
examples:
  - packages/dogfood/examples/derived-values
---

A filter is a function of the rows. A total is a function of the filter. Writing either of them
down twice — once as the computation and once as the list of things that should re-run it — is
where derived values go stale.

{% example derived-values %}

*3 derivations, 0 dependency lists* — against each computation written once and its inputs
written again beside it.

You never register anything. `visible` read `showPaid`, so `showPaid` is what re-runs it.

## A memo re-runs when what its body read changes

Whatever the body **read** on its last run — that is the whole dependency graph. Reading is what
subscribes, so the graph is discovered rather than declared, and it can change from one run to
the next without anything being kept in step.

{% snippet derived-values src/shared/ledger.ts export const visible %}

When `showPaid` is true the body never touches `row.paid`, and nothing about that has to be
declared either. Tick the box above and this is the read that leaves the graph.

## A memo is a `Reactive`, not a wrapper

An unkeyed `memo` **is** a `Reactive`. It is not a box you unwrap and it has no members of its
own, which is what makes all of this read the same as a state:

{% snippet derived-values src/ui/pages/ledger/page.abide {#if rows.pending()} … <p>{total} %}

`{total}` is a read by name and `rows.pending()` is the ordinary probe — the same two
spellings a `state` gets, on values nothing declared as states.

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

{% snippet derived-values src/shared/ledger.ts export const rows %}

— because a `<script>` setup body is untracked, so the call alone would register nothing and the
value would never follow `year`. The outer memo is what makes the call reactive to its arguments.
Without adoption you would also be holding a `Reactive<Reactive<Invoice[]>>`, and `rows.length`
would reach the wrapper rather than the rows.

Adoption is an identity cutoff too: a recompute that lands on the **same** inner value wakes
nobody, and an args key that hits a live entry adopts synchronously — so re-filtering back to a
key already held never flashes a spinner, not for a microtask.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Caching](load-once-per-set-of-arguments.md)

## `transform` reshapes an adopted value without losing the adoption

An inline expression cannot reshape an adopted value, because reading the `Reactive` to reshape
it is exactly what loses the adoption. `transform` runs **after** adoption, on the settled
payload:

{% snippet derived-values src/shared/ledger.ts export const paidIds %}

Reaching inside — `memo(() => new Set(listInvoices({ year }).map(…)))` — reads the `Reactive`
to reshape it, and that read is the adoption gone.

## A write to a memo stands until the next recompute

A memo is writable, and a write stands until the next recompute clobbers it. On an unkeyed memo
that means it survives until something the body read moves — which is one primitive rather than
two:

{% snippet derived-values src/shared/ledger.ts export const draft %}

That is a local draft re-seeded from its source. Edit it and the edits stand; when `visible`
lands new rows, the draft is rebuilt from them.

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

The handler this page's ledger reads is the second row — one parameter, so a factory:

{% snippet derived-values src/server/rpc/invoices.ts export const listInvoices %}

A `Memo` is `(args) => Reactive` with `invalidate` and `refresh` on it, the factory being what has
an args space to narrow over. So the probes live on the invoked result — `listInvoices({
year }).pending()` — and there is no `listInvoices.pending()` to reach for.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Reloading](decide-when-a-value-reloads.md)

## A read after an `await` registers nothing

Tracking is synchronous. A body suspends at its first `await` and the subscriber is restored, so
a reactive read in the continuation subscribes to nothing — reliably nothing, which is why the
compiler **warns** and names the read rather than leaving you a memo that is correct once and
stale forever.

{% snippet derived-values src/shared/ledger.ts export const summary %}

Two repairs, and the first is also the faster shape: hoist the read above the `await`, or say
`peek()` where the read was meant to be untracked.

Read on: [Reloading](decide-when-a-value-reloads.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — one entry per set of arguments
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — when the inputs move too fast
* [Watching values](do-something-when-a-value-changes.md) — for effects, where a memo is for values
