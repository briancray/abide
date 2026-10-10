---
title: Derive a value from other values
nav: Derived values
intent: Compute something from what you already have, and recompute it only when the inputs move.
covers:
  - `Keyed`
  - `reactive` body, unkeyed
examples:
  - packages/dogfood/examples/memo-tracked.json
  - packages/dogfood/examples/memo-adoption.json
  - packages/dogfood/examples/memo-write.json
  - packages/dogfood/examples/memo-keyed.json
  - packages/dogfood/examples/memo-await.json
  - packages/dogfood/examples/memo-provisional.json
---

Everything on this page is `reactive` given a body: a value computed from other values, which
recomputes when they move and not otherwise. You write the computation once, and what it read
re-runs it.

## The two body forms of `reactive`

A body comes in two forms, and its parameter picks between them.

| You write | You get |
| --- | --- |
| `reactive(() => …)` | a `Reactive` — **tracked**, recomputing when what it read changes |
| `reactive((args) => …)` | a `Keyed` — a factory, **untracked**, one entry per args key |

Both take `schema`, `transform`, `store`, `global`, `tags`, `throttle` and `debounce`,
and both hand back something a page reads by name. Every signature and every member is in the
[`reactive` reference](../reference/reactive.md).

## A derived value re-runs when what its body read changes

{% example memo-tracked %}

*1 line, 0 dependency lists* — against the two variables the hand-written arm keeps to recompute
no more often than this does.

Whatever the body **read** on its last run is the whole dependency graph. Reading subscribes, so
the graph is discovered rather than declared, and it can change from one run to the next without
anything being kept in step.

## A derived value is a `Reactive`, not a wrapper

A derived value has no members of its own, so every spelling on it is the one a value you write
gets:

| You write | On a value you write | On a derived value |
| --- | --- | --- |
| a read | `{total}` | `{total}` |
| a probe | `contact.busy()` | `contact.busy()` |
| a write | `total = 0` | `total = 0` |

There is one `set` in the design and it is `Reactive`'s, so writing to a derived value is the
member the type already declares.

## Make a call re-run when its arguments change

{% example memo-adoption %}

A `<script>` setup body is untracked, so the call written bare registers nothing and never follows
`id`. Wrapping it in a body is the only spelling that does, and that wrapper is compulsory rather
than a matter of taste.

It costs nothing, and that is **adoption**. A body returning another `Reactive` is adopted
rather than stored: the outer subscribes to the inner and mirrors its productions as its
own. Every probe forwards from the adopted value, `error()` included (11.50), and a trigger on the
outer reaches the adopted one (11.51). So the reads reach the record rather than a box to be opened
first, and `busy` belongs to the load. A wrapper that stored the call would settle the moment
its body returned, and its `busy` would read false for the whole of the load it wraps.

`transform` runs after that adoption rather than instead of it, on the settled payload (11.14). A
write does not stop at the outer value, though: it reaches the one adopted (11.59), so a reshape you
mean to patch reads the load rather than adopting it — see
[Patching a list](patch-a-list-from-a-live-feed.md).

Adoption is an identity cutoff too: an args key that hits a live entry adopts synchronously.
Reopening a tab already held is the body running again over a request that never happens, and the
record's own count says so. `opened` is kept by the handler, which runs once per request that
reaches it, so it counts loads. A count taken in the browser would count runs of the body, and
those do go up.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Caching](load-once-per-set-of-arguments.md)

## A write to a derived value stands until the next recompute

{% example memo-write %}

A derived value is writable, and a write stands until the next recompute clobbers it. That means
it survives until something the body read moves — one primitive rather than a second value beside
it and an effect keeping the two in step.

That is also the trade. The reload is a new answer even where the fields are identical, because
the cutoff compares identity, and the handler builds a record per call.

That is a body computing its value. One handing back a `Reactive` passes the write through to the
value it adopted instead (11.59).

There is no warning on that write, and there could not be a useful one: `reactive(() =>
structuredClone(upstream))` and `reactive(() => a + b)` are indistinguishable to a compiler, so a
warning would fire hardest on the good pattern.

A write of a settled value is not a load — `ready()` stays true and `busy()` never moves. A
write of an unsettled one **is** a load and moves the probes the way any load does.

## A keyed value holds one entry per set of arguments

{% example memo-keyed %}

Every keystroke is a key, so backspacing lands on an entry already held: nothing is asked for
and `busy` never gets a moment to be true. The factory does not cap the load. Every word not
typed before is a request of its own, and `throttle` caps them. A `Keyed` is `(args) => Reactive`
with `busy`, `ready`, `invalidate` and `refresh` on it as well — the factory holds every key, and
so it is the only thing with an args space to narrow. `searchContacts({ query }).busy()` asks about
one entry, and `searchContacts.busy()` about every entry or those a partial args matches (13.2).

An entry does not recompute when something its body read moves (11.6, 14.4).

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) ·
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

## A branch on a value that has not landed paints nothing yet

{% example memo-provisional %}

The body never takes the wrong arm. Reading `viewer` before it lands throws `NotLanded`, which
abandons the run (2.12), and the body runs again when the gate lands (2.13). The abandoned run is
**provisional** and mints no production (11.52): nothing is stored, no `transform` sees it,
no `store` is written, and no reader is served. You write no `?.`, because nothing past the read
runs.

The hole is where the wait shows. `mode === 'locked'` throws the same way, and an abandoned
expression leaves what it last rendered in place (32.23). On the first frame that is no `disabled`
at all, so the top `Save` is live until the answer arrives.

Only you know which answer is safe before there is one, so say it with the probe:

{% snippet memo-provisional src/ui/components/MemoProvisionalContact.abide <button disabled={!mode %}

Locked is the answer until the gate says otherwise, so the second `Save` is dead on the first frame
rather than live for one.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md)

## A read in a condition makes the body re-subscribe

A body is tracked by the ORDER of the reads it makes, which is what keeps a recompute to a
pointer compare per source. `flag() ? one() : two()` reads a different second source every time
the flag moves, so the match fails at the flag, everything after it is detached, and both sources
are subscribed again — per recompute, for as long as the value lives.

The compiler **warns** and names the read (14.15). Two repairs, and both are the same move: read
the values above the branch so the order is fixed, or give each arm its own value and branch over
the two. A `{#if}` in markup is untouched — a block binds each read in its subject once for the
body, so the order there cannot alternate.

Read on: [Watching values](do-something-when-a-value-changes.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — one entry per set of arguments
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — when the inputs move too fast
* [Watching values](do-something-when-a-value-changes.md) — for effects, where a body is for values
