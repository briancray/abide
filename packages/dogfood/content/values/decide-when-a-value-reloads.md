---
title: Decide when a value reloads
nav: Reloading
intent: Mark something stale, force it to reload now, or let it expire on its own.
covers:
  - `m.invalidate`
  - `m.refresh`
  - `s.invalidate`
  - `s.refresh`
  - `Selection`
  - `refresh`
  - `invalidate`
  - state › `ttl`
  - `s.peek`
examples:
  - packages/dogfood/examples/reloading
---

Reading loads a value. So what decides when a loaded value is stale?

There are three answers, and they are three because they fail differently.

| | Reloads | Costs |
| --- | --- | --- |
| `ttl` | on the next read after it lapses | nothing until somebody reads |
| `invalidate()` | on the next read | nothing at all, subscribed or not |
| `refresh()` | now, wherever something subscribes | one load per subscribed entry, a mark for the rest |

{% example reloading %}

*2 triggers, 0 cache keys* — the value already holds its own args and its own loader, so
neither button repeats them.

## `invalidate` marks stale; `refresh` reloads now

{% snippet reloading src/ui/pages/stock/[warehouse]/[sku]/page.abide <button onclick={() => level.invalidate()} … <button onclick={() => level.refresh()} %}

`invalidate()` marks the value stale and loads nothing. It is the cache behind the value that
goes, not the value — so nothing happens whether or not anybody is looking, and the fetch belongs
to the next read.

`refresh()` is stale-while-revalidate: what is held **keeps being served**, `refreshing()` is
true, and the value swaps when the new one lands. Nothing on screen goes blank, and `{:then}`
stays mounted with the old value. Where nothing subscribes to the entry there is no reader to
serve and no spinner to show, so it degenerates to the row above it.

What each one touches is the **cache behind the value** rather than the value on screen — and
the cache is exactly what decides what a reader sees next:

| | subscribed | not subscribed |
| --- | --- | --- |
| `invalidate()` | the value on screen stays; the cache behind it is dropped | the cache is dropped |
| `refresh()` | loads now, and what is held keeps being served | degenerates to `invalidate()`, so nothing loads |

A **subscriber** is anything reading the value into the output — the template showing it, or a
`memo` that is itself subscribed. On screen is the common case rather than the rule, which
matters for a derived value nothing renders directly. Either way the next read — a render, or a
read by hand — is fetched fresh.

The difference a reader **sees** therefore lands on that next load, and it follows from the row
above. After an `invalidate()` there is nothing left to serve, so the load renders the pending
branch — a display, a read by hand and a `refresh()` alike. A `refresh()` on its own never does,
having kept the held value to serve underneath it.

So `invalidate()` never moves a node and never sends a request, which is what the example above
shows: press **Mark stale** and neither the number nor the request count moves. Go to West and
back and the count moves there, on the display that had no cache left to serve it — and what
makes that attributable is that returning to a key which was *never* marked costs no request at
all. **Reload now** is the other column: the request goes out on the click and 128 is on screen
the whole way across.

**Which makes the two dangerous in that order.** `invalidate()` throws away exactly what
stale-while-revalidate would have served, so the `refresh()` behind it is a load with nothing
underneath — the one way the eager trigger blanks a page:

{% snippet reloading src/ui/pages/stock/[warehouse]/[sku]/page.abide {#if level.pending()} … <p>Counting the shelf … {:else} … <p>On hand … <p class="hint">Counted … {/if} %}

Press **Mark stale** and then **Reload now** in the example and that is what you get — same two
requests as the eager path, same value at the end, and the page blank in between.
`invalidate(); refresh()` over a scope is how an app blanks itself, and either one alone is fine.

Neither one holds rendering by itself. Whether a template waits is the template's own choice of
form — `{await invoice}` and `{#await invoice then row}` wait, `{#await invoice}{:then}` does not.

Both are inert on a value with no producer. `s.invalidate()` on a `state(0)` has nothing to
fetch, so it does nothing rather than clearing what you put there. Two things give one a
producer — a load at construction, and a `store` — and with either the pair stops being inert.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Persistence](keep-a-value-outside-the-process.md)

## A selection is the set a trigger acts on

The members above are conveniences over four free functions, and a `Selection` is what those take:

| A `Selection` is | Means |
| --- | --- |
| one `Reactive` | that value |
| one keyed memo | every args key of it |
| `{ tags: [...] }` | every entry carrying any of those tags, **across memos** |
| nothing | this scope |

```ts shared
import { invalidate, refresh, pending } from 'abide'

invalidate(level)                     // ≡ level.invalidate()
invalidate({ tags: ['sku:A-70'] })    // across every memo tagging it
refresh(getStock)                     // every args key, loaded now
pending()                             // anything in this scope in flight
```

The member spellings are **defined as** these, not a second mechanism at a second width:
`s.refresh()` is `refresh(s)`, and `getStock.refresh(args)` is `refresh(getStock)` narrowed
to part of its args space — which is the next section.

Two rules make the wide forms safe to reach for.

**An explicit argument reaches anything; a bare sweep reaches producers.** Passing a `Reactive`
is a deliberate act about one value, so the triggers are on every `Reactive` — including the ones
where they do nothing. A bare `invalidate()` is indiscriminate, so it matches only entries
**with** a producer: a `state(0)` caught by a sweep is silent data loss, and a room has nothing
to re-run.

**A selection is scope-bounded**, as a memo is: this scope's entries plus `global` ones. So one
request can never invalidate another's. On a server that makes a bare `invalidate()` reach every
`global` memo in the process — its own request-scoped entries die with the request anyway, so the
globals are the whole effect. That is what an operator's flush endpoint wants and never what a
handler being defensive wants:

{% snippet reloading src/server/rpc/stock.ts export const flushStock %}

There is no bare form wider than the scope. A probe reports and a trigger acts, so the widest
read is free and the widest write is one an app should have to mean.

## Reload a keyed memo by `Partial<Args>`

A keyed memo is a factory: `getStock({ warehouse, sku })` hands back the `Reactive` for one key,
and that value carries the triggers like any other — `getStock({ warehouse, sku }).invalidate()`
reloads that one entry. What the factory adds is the **narrowing**, because one entry has one key
and nothing to choose among; `getStock` holds every key.

| Written | Reaches |
| --- | --- |
| `getStock.invalidate()` | every entry |
| `getStock.invalidate({ sku: 'A-70' })` | that shelf in every warehouse |
| `getStock.refresh({ warehouse: 'east' })` | one warehouse, loaded now |

The argument is a `Partial<Args>`, so it selects a slice rather than one key — the same selection
the section above takes, narrowed by the one thing a keyed memo has that a lone `Reactive` does
not. It is also the only place args granularity is spelled, and the place with the `Args` type to
check it against, which makes it the natural thing to write after a mutation:

{% snippet reloading src/server/rpc/stock.ts export const bookOut %}

**A write needs a trigger on each side that holds the value**, because a selection is
scope-bounded and the two scopes are different caches. The handler above reaches the process-wide
entry, so the next caller loads fresh; the browser that made the call is a scope of its own, and
the number on its screen is still the one from before the write. So the page does its own:

{% snippet reloading src/ui/pages/stock/[warehouse]/[sku]/page.abide async function book() { %}

The verbs differ for the reason the table at the top gives. On the server nothing subscribes to
the value, so `refresh` there would degenerate to `invalidate` and the shorter word is the honest
one. In the page it **is** subscribed, so `refresh` reloads it under stale-while-revalidate where
`invalidate` would have dropped it to the pending branch — a write that blanks the row it just
changed. Press **Book one out** in the example and watch 128 stay put.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Mutations](../server/change-something-on-the-server.md)

## A reconnect reloads what a reader is holding

At this width the lazy/eager difference stops being a nuance:

{% snippet reloading src/ui/pages/layout.abide watch(() => { %}

The eager form is **bounded by what is subscribed**, not by the scope: it reloads the handful
something is reading and degenerates to a mark for the other hundred and ninety-odd. So a
reconnect costs exactly what a reader is holding, and nothing stale is left in front of them.

`invalidate()` at this width is for the case where nothing on screen may move — it reaches the
same entries and leaves every value standing, so the catch-up happens on the next read. What it
is not is a cheaper `refresh()` to reach for first: the two in that order blank every reader, per
the section above.

Read on: [Offline](../app/know-when-the-browser-goes-offline.md) ·
[Watching values](do-something-when-a-value-changes.md)

## `ttl` expires a value with nobody asking

`ttl` is the life of a **retained production** — one definition reaching all three producers. At
the default retention a value holds one production, so past its `ttl` the producer recomputes on
the next read. A room retaining a hundred messages has a hundred, each on its own clock.

{% snippet reloading src/server/rpc/stock.ts const stockForShelf = memo( %}

Expiry **wakes nobody**. Entries past it are dropped on the read that follows — no timer per
entry, no version bump — because a timer that moved the version would put the cost of retention
back on the write.

**A lapsed `ttl` lands where an `invalidate()` lands.** For a value holding one production the
two are the same event: nothing loads, nothing wakes, what is on screen stays, and the read that
follows fetches with nothing to serve underneath it. Come back to a page after an idle spell and
find it pending: that is a lapsed `ttl`, not a bug.

They separate on the **unit**. `ttl` is per retained production, each on its own clock, so at
`tail: 100` it can drop part of a ring and keep the rest — where a trigger is over a value, or a
selection of them, and never over part of one. That is also why `ttl` reaches a room's retained
messages and a bare `invalidate()` passes over them, a room having nothing to re-run. And a `ttl`
is declared rather than called, so no pattern narrows it and no tag carries it across memos.

On an owned value there is no producer and nothing was loaded, so `ttl` is inert rather than
destructive: it never drops what an app put there. It still reaches a state that was **given** a
load, `state(fetchUser())` having a production to expire and `refresh()` to reload it — and a
state with a `store`, which has somewhere to get the dropped value back from.

Read on: [Local state](show-a-value-that-changes.md) ·
[History & tail](keep-the-last-few-values.md) ·
[Persistence](keep-a-value-outside-the-process.md)

## `peek` reads without starting a load

Since reading loads, a read from somewhere that only wants to look is a subscription you
did not want. `peek` is the read that does not join the flow — same value, same load, no
subscription — and "held, but do not load" is the probe in front of it, a probe never starting
work:

{% snippet reloading src/ui/pages/stock/[warehouse]/[sku]/page.abide watch(() => { %}

It is otherwise identical to a read: it starts work if there is work to start, and it throws what
a read throws. That effect is tracked, so the route wakes it; the level is read through `peek`, so
a new count never does.

`watch(sources, effect)` is the other way to the same place, and a memo has only this one, having
no `sources` form. They differ in what they do to the tracking: `sources` **replaces** it with a
list you write, and `peek` leaves it on and takes **one read** out of it. So reach for one or the
other — inside a `sources` list there is no tracking left for a `peek` to opt out of.

Read on: [Watching values](do-something-when-a-value-changes.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — where the entries being invalidated live
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — capping revalidation, however triggered
* [Mutations](../server/change-something-on-the-server.md) — reloading after a write
