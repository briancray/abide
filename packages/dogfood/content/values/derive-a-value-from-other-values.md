---
title: Derive a value from other values
nav: Derived values
intent: Compute something from what you already have, and recompute it only when the inputs move.
covers:
  - `memo`
  - `Memo`
  - `memo` body, unkeyed
examples:
  - packages/dogfood/examples/memo-tracked
  - packages/dogfood/examples/memo-adoption
  - packages/dogfood/examples/memo-write
  - packages/dogfood/examples/memo-keyed
  - packages/dogfood/examples/memo-await
---

Everything on this page is `memo`: a value computed from other values, which recomputes when they
move and not otherwise. You write the computation once, and what it read is the list of what
re-runs it.

## The two forms

`memo` is one name with two, and the body's parameter is what picks between them.

| You write | You get |
| --- | --- |
| `memo(() => …)` | a `Reactive` — **tracked**, recomputing when what it read changes |
| `memo((args) => …)` | a `Memo` — a factory, **untracked**, one entry per args key |

Both take `schema`, `store`, `global`, `tags`, `throttle` and `debounce`, and both hand back
something a page reads by name. Every signature and every member is in the
[`memo` reference](../reference/memo.md).

## A memo re-runs when what its body read changes

{% example memo-tracked %}

*1 line, 0 dependency lists* — against the two variables the hand-written arm keeps to recompute
no more often than this does.

Whatever the body **read** on its last run is the whole dependency graph. Reading is what
subscribes, so the graph is discovered rather than declared, and it can change from one run to the
next without anything being kept in step.

## A memo is a `Reactive`, not a wrapper

An unkeyed `memo` **is** a `Reactive`. It is not a box you unwrap and it has no members of its
own, which makes every spelling on it the one a `state` gets:

| You write | On a `state` | On an unkeyed `memo` |
| --- | --- | --- |
| a read | `{total}` | `{total}` |
| a probe | `contact.pending()` | `contact.pending()` |
| a write | `total = 0` | `total = 0` |

There is one `set` in the design and it is `Reactive`'s, so writing to an unkeyed memo is the
member the type already declares.

## Make a call re-run when its arguments change

{% example memo-adoption %}

A `<script>` setup body is untracked, so the call written bare registers nothing and never follows
`id`. Wrapping it in a memo is the only spelling that does, and that wrapper is compulsory rather
than a matter of taste.

What it costs is nothing, and that is **adoption**. A body returning another `Reactive` is adopted
rather than stored: the outer subscribes to the inner, mirrors its productions into its own ring,
and forwards its probes and triggers. So the reads reach the record rather than a box to be opened
first, and `pending` belongs to the load. A wrapper that stored the call would settle the moment
its body returned, and its `pending` would read false for the whole of the load it wraps.

`transform` runs after that adoption rather than instead of it, on the settled payload, so a
reshape keeps the load rather than reading it — see
[Patching a list](patch-a-list-from-a-live-feed.md).

Adoption is an identity cutoff too: an args key that hits a live entry adopts synchronously.
Reopening a tab already held is the body running again over a request that never happens, and the
record's own count says so.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Caching](load-once-per-set-of-arguments.md)

## A write to a memo stands until the next recompute

{% example memo-write %}

A memo is writable, and a write stands until the next recompute clobbers it. On an unkeyed memo
that means it survives until something the body read moves — one primitive rather than a state
beside the memo and an effect keeping the two in step.

That is also the trade. The reload is a new answer even where the fields are identical, because
identity is what the cutoff compares and the handler builds a record per call.

There is no warning on that write, and there could not be a useful one: `memo(() =>
structuredClone(upstream))` and `memo(() => a + b)` are indistinguishable to a compiler, so a
warning would fire hardest on the good pattern.

A write of a settled value is not a load — `success()` stays true, `refreshing()` stays false. A
write of an unsettled one **is** a load and moves the probes the way any load does.

## One entry per set of arguments

{% example memo-keyed %}

A word searched twice lands on an entry already held, so nothing is asked for and `pending` never
gets a moment to be true. A `Memo` is `(args) => Reactive` with `invalidate` and `refresh` on it
as well — the factory holds every key, and so it is the only thing with an args space to narrow.
The probes are on the result alone: `searchContacts({ query }).pending()`, and there is no
`searchContacts.pending()` to reach for.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Reloading](decide-when-a-value-reloads.md)

## A value read after an `await` stops following

{% example memo-await %}

Tracking is synchronous. A body suspends at its first `await` and the subscriber is restored, so
a reactive read in the continuation subscribes to nothing — reliably nothing. The compiler
**warns** and names the read, rather than leaving you a label that is correct once and stale
forever.

Two repairs, and hoisting the read is also the faster shape: move it above the `await`, or say
`peek()` where the read was meant to be untracked.

Read on: [Reloading](decide-when-a-value-reloads.md)

## A branch on a value that has not landed takes the wrong arm

A read that has not landed is `undefined`, and `undefined` is falsy. So a body branching on one
takes its `else` — and whether that is the harmless arm depends on which way you wrote the
condition:

```ts shared
memo(() => (isAnonymous() ? publicView() : privateView()))
```

On the first run `isAnonymous()` has not landed, so this calls `privateView()` for a caller
nothing has authenticated yet. The compiler **warns** and names the read, as it does for a read
after an `await`.

What the warning cannot promise is completeness: a body calling a helper that branches is out of
its reach. So the framework guarantees the other half instead. A run that read an unlanded value
is **provisional** and mints no production, which is the unit every path downstream is written
over — nothing enters the ring, no `transform` sees it, no `store` is written, and no reader is
served. When the value lands, the run that reads nothing unlanded is the first real production.

The call still went out, and only you can stop that, because only you know which read is a
**gate** and which is a **payload**. Settle the gate before branching on it:

```ts shared
memo(async () =>
    (await isAnonymous.settled()) ? publicView() : privateView(),
)
```

Read on: [Loading states](show-a-value-that-isnt-there-yet.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — one entry per set of arguments
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — when the inputs move too fast
* [Watching values](do-something-when-a-value-changes.md) — for effects, where a memo is for values
