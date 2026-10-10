---
title: Decide when a value reloads
nav: Reloading
intent: Mark something stale, force it to reload now, or let it expire on its own.
covers:
  - `k.invalidate`
  - `k.refresh`
  - `rpc.invalidate`
  - `rpc.refresh`
  - `s.invalidate`
  - `s.refresh`
  - `Selection`
  - `refresh`
  - `invalidate`
  - `ttl`
  - `s.peek`
examples:
  - packages/dogfood/examples/reload-triggers.json
  - packages/dogfood/examples/reload-args.json
  - packages/dogfood/examples/reload-ttl.json
---

Reading loads a value. So what decides when a loaded value is stale?

There are three answers, and they are three because they fail differently.

| | Reloads | Costs |
| --- | --- | --- |
| `ttl` | on the next read after it lapses | nothing until somebody reads |
| `invalidate()` | on the next read | nothing at all, subscribed or not |
| `refresh()` | now on a named value; under a sweep, wherever something subscribes | one load per entry reloaded, a mark for the rest |

## `invalidate` marks stale; `refresh` reloads now

{% example reload-triggers %}

*2 triggers, 0 cache keys* — the value already holds its own args and its own loader, so
neither button repeats them.

`invalidate()` marks the value stale and loads nothing. It is the cache behind the value that
goes, not the value — so no node moves and no request goes out, whether or not anybody is looking,
and the fetch belongs to the next read.

`refresh()` is stale-while-revalidate: what is held **keeps being served**, so the value is `busy()`
and still `ready()`, and it swaps when the new one lands. Nothing on screen goes blank, and a
branch on `ready()` stays mounted with the old value.

Naming one value reloads it whether or not anything is reading it. You named a single thing, so
the load is the whole of what you asked for — and the alternative was a call that meant two
things depending on what happened to be mounted. A **sweep** is the other story, and it is the
one that spares what nobody reads.

Each one touches the **cache behind the value** rather than the value on screen — and the cache
is exactly what decides what a reader sees next:

| | subscribed | not subscribed |
| --- | --- | --- |
| `invalidate()` | the value on screen stays, `ready()` with it; the next read loads with nothing underneath | the cache is dropped |
| `refresh()` | loads now, and what is held keeps being served | loads now; nobody is holding it, so nothing is served meanwhile |

A **subscriber** is anything reading the value into the output — the template showing it, or a
derived value that is itself subscribed. On screen is the common case rather than the rule, which
matters for a derived value nothing renders directly. Either way the next read — a render, or a
read by hand — is fetched fresh.

An `invalidate()` says what is held is **wrong**, and changes nothing a reader can see: nothing
runs and nobody wakes, a guard asking `ready()` included (7.3, 7.14) — which is what lets a server
say "yours is stale" without a page moving. The next read or probe of it runs the producer (3.2,
7.12), and that is where the held value stops being served, with
nothing trusted underneath (7.8) — a first load again, for a display, a read by hand and a
`refresh()` alike. A `refresh()` never does that:
it says the held value is good, where an invalidate says it is wrong, and that difference is the
one a reader can see.

So `invalidate()` never moves a node and never sends a request (7.3). Press **Mark stale** on the
card and neither the count nor the number of loads moves. The fetch belongs to whatever reads
next. **Reload now**
is the other column: the request goes out on the click and 128 is on screen the whole way across.

The hand-written arm is where that costs something. **Stale is a third state**, and it is the one
a hand-written cache usually does not have: one variable says what can be served and another says
whether it may be. Collapse the two and marking something stale either blanks the page or does
nothing at all.

**Which makes the two dangerous in that order.** `invalidate()` throws away exactly what
stale-while-revalidate would have served, so the `refresh()` behind it is a load with nothing
underneath (7.8) — the one way the eager trigger blanks a page. Press **Mark stale** and then
**Reload now** and that is what you get: same two requests as the eager path, same value at the
end, and the page blank in between.
`invalidate(); refresh()` over a scope is how an app blanks itself, and either one alone is fine.

Neither one holds rendering by itself. Nothing does: a value still in flight is a hole in the
document that fills when it lands, and a reload is that hole reopening rather than the page
stopping.

Both are inert on a value with no producer (7.6). `s.invalidate()` on a `reactive(0)` has nothing
to fetch, so it does nothing rather than clearing what you put there. A load handed in at
construction is no producer either: it is one answer, with nothing to ask again. A body is a
producer and so is a `store` (8.2), and with either the pair stops being inert. On a wired value
the pair still reaches every subscriber's copy (7.10, 7.18).

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Persistence](keep-a-value-outside-the-process.md)

## A selection is the set a trigger acts on

The members above are conveniences over four free functions, and those four take a `Selection`:

| A `Selection` is | Means |
| --- | --- |
| one `Reactive` | that value |
| one keyed value | every args key of it |
| one handler | the value behind it — every args key, where it is keyed |
| `{ tags: [...] }` | every entry carrying any of those tags, **across values** |
| nothing | this scope |

```ts shared
import { busy, invalidate, refresh } from '@abide/abide'

invalidate(level)                     // ≡ level.invalidate()
invalidate({ tags: ['sku:A-70'] })    // across every value tagging it
refresh(getStock)                     // every args key, loaded now
refresh(getStock, { sku: 'A-70' })    // ≡ getStock.refresh({ sku: 'A-70' })
busy()                                // anything in this scope in flight
```

The member spellings are **defined as** these, not a second mechanism at a second width:
`s.refresh()` is `refresh(s)`, and `getStock.refresh(args)` is `refresh(getStock, args)` — the
selection narrowed to part of its args space, which is the next section (13.4, 13.12).

Two rules make the wide forms safe to reach for.

**An explicit argument reaches anything; a bare sweep reaches loads.** Passing a `Reactive`
is a deliberate act about one value, so the triggers are on every `Reactive` — including the ones
where they do nothing. A bare `invalidate()` is indiscriminate, so it matches only entries whose
producer is a **load**: a `store`, or a body that handed back a pending answer or a stream. A
`reactive(0)` caught by a sweep is silent data loss, and a value with no producer has nothing for
a trigger to re-run (7.6). A synchronous derivation recomputes from the load it reads (13.14).

**A selection is scope-bounded**, as a reactive value is: this scope's entries plus `global` ones.
So one request can never invalidate another's. On a server that makes a bare `invalidate()` reach
every `global` value in the process — its own request-scoped entries die with the request anyway, so
the globals are the whole effect. A bare `refresh()` reaches the same entries; nothing subscribes on
a server, so there it marks them and the two are one call. An operator's flush endpoint wants that;
a handler being defensive never does.

There is no bare form wider than the scope. A probe reports and a trigger acts, so the widest
read is free and the widest write is one an app should have to mean.

## Reload a keyed value by `Partial<Args>`

{% example reload-args %}

A keyed value is a factory: `getStock({ warehouse, sku })` hands back the `Reactive` for one key,
and that value carries the triggers like any other — `getStock({ warehouse, sku }).invalidate()`
reloads that one entry. The factory adds the **narrowing**, because one entry has one key and
nothing to choose among; `getStock` holds every key.

| Written | Reaches |
| --- | --- |
| `getStock.invalidate()` | every entry |
| `getStock.invalidate({ sku: 'A-70' })` | that shelf in every warehouse |
| `getStock.refresh({ warehouse: 'east' })` | one warehouse, loaded now |

The argument is a `Partial<Args>`, so it selects a slice rather than one key: a `Selection`
narrowed by the one thing a keyed value has that a lone `Reactive` does not. It is also the only
place args granularity is spelled, and the place with the `Args` type to check it against, which
makes it the natural thing to write after a mutation.

**A write needs a trigger on each side that holds the value**, because a selection is
scope-bounded and the two scopes are different caches. The handler above reaches the process-wide
entry, so the next caller loads fresh; the browser that made the call is a scope of its own, and
the number on its screen is still the one from before the write. So the page does its own.

The verbs differ for the reason the table at the top gives. Both forms here are a **sweep** over
an args pattern, and a sweep reloads only what something is reading — so on a server, where
nothing is, `refresh` would come to exactly what `invalidate` does and the shorter word is the
honest one. In the page it **is** subscribed, so `refresh` reloads it under stale-while-revalidate
where `invalidate` would have left the next read loading with nothing trusted to serve — a write
that blanks the row it just changed.

The pattern is also what keeps the sweep narrow. Press **Book one out of east** and east loads
again while west, holding the same shelf under a different key, does not — which a refresh over
every key would not have managed.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Mutations](../server/change-something-on-the-server.md)

## A reconnect reloads what a reader is holding

At this width the lazy/eager difference stops being a nuance.

The eager form is **bounded by what is subscribed**, not by the scope: it reloads the handful
something is reading and degenerates to a mark for the other hundred and ninety-odd. So a
reconnect costs exactly what a reader is holding, and nothing stale is left in front of them.

`invalidate()` at this width is for the case where nothing on screen may move — it reaches the
same entries and leaves every value standing, so the catch-up happens on the next read. It is not a
cheaper `refresh()` to reach for first: `invalidate()` and then `refresh()` blanks every reader.

Read on: [Offline](../app/know-when-the-browser-goes-offline.md) ·
[Watching values](do-something-when-a-value-changes.md)

## `ttl` expires a value with nobody asking

{% example reload-ttl %}

`ttl` is the life of the production a value serves, or of a keyed entry (11.45) — one definition
reaching every producer. Past it the production is released (6.7), and the next read runs the
producer (6.6).

Expiry **wakes nobody** (6.1). One timer per value is armed at the deadline of the production it
serves (6.3), and it does not hold the process open (6.4).

**A lapsed `ttl` lands almost where an `invalidate()` lands.** Nothing loads, nobody is woken (6.1,
7.14), and the read that follows fetches with nothing to serve underneath it. The difference is
what is held meanwhile: a lapse releases the production (6.7) and reads as not ready (6.8), where
an invalidated value goes on being served until a read or a probe runs the producer (7.17). Come
back to a page after an idle spell and find it pending: that is a lapsed `ttl`, not a bug.

They separate on how they are reached. A trigger is called, over a value or a selection of them; a
`ttl` is declared, so no pattern narrows it and no tag carries it across values.

On an owned value there is no producer, and `ttl` is inert (6.2): it never drops what an app put
there. A value **given** a load is the same case, the load being one answer rather than a producer.
A value with a `store` is not, having somewhere to get the dropped value back from (8.2).

Read on: [Local state](show-a-value-that-changes.md) ·
[Persistence](keep-a-value-outside-the-process.md)

## `peek` reads without subscribing

Reading subscribes, so a read from somewhere that only wants to look is a subscription you did not
want. `peek` is the read that does not join the flow (2.11) — same value, no subscription:

```ts shared
watch(() => {
    const page = route.url().pathname
    log.info('viewed', { page, onHand: level.peek()?.onHand })
})
```

That effect is tracked, so the route wakes it. The level is read through `peek`, so a new count
never does.

It is otherwise a read. It runs the reload a read would run, after an `invalidate` (7.12) or a
lapsed `ttl` (6.6), and where nothing has landed it answers `undefined` rather than throwing
`NotLanded` (2.10). A probe runs the same reload, since it answers about the value a read would
serve (3.2), so `ready()` in front of a read never admits one that throws.

`watch(sources, effect)` is the other way to the same place, and a `reactive` body has only this
one, having no `sources` form. They differ in what they do to the tracking: `sources` **replaces**
it with a list you write, and `peek` leaves it on and takes **one read** out of it. So reach for one
or the other — inside a `sources` list there is no tracking left for a `peek` to opt out of.

Read on: [Watching values](do-something-when-a-value-changes.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — where the entries being invalidated live
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — capping revalidation, however triggered
* [Mutations](../server/change-something-on-the-server.md) — reloading after a write
