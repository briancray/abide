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
---

Reading is what loads a value, so the question a cache usually asks — when do I fetch — is
already answered. What is left is the other one: when does what I am holding stop counting.

There are three answers, and they are three because they fail differently.

| | Reloads | Costs |
| --- | --- | --- |
| `ttl` | on the next read after it lapses | nothing until somebody reads |
| `invalidate()` | on the next read | nothing until somebody reads |
| `refresh()` | now | one load per entry, whether or not anyone is looking |

## `invalidate` marks stale; `refresh` reloads now

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<button onclick={() => invoice.invalidate()}>Reload</button>
<button onclick={() => invoice.refresh()}>Reload now</button>
```

*2 triggers, 0 cache keys* — the value knows what it loads, so neither button names anything.

`invalidate()` marks the value stale and loads nothing. The next read fetches rather than being
served what is held, so nothing happens if nobody is looking.

`refresh()` is stale-while-revalidate: what is held **keeps being served**, `refreshing()` is
true, and the value swaps when the new one lands. Nothing on screen goes blank, and `{:then}`
stays mounted with the old value.

Neither one holds rendering by itself. Whether a template waits is the template's own choice of
form — `{await invoice}` and `{#await invoice then row}` wait, `{#await invoice}{:then}` does not.

Both are inert on a value with no producer. `s.invalidate()` on a `state(0)` has nothing to
fetch, so it does nothing rather than clearing what you put there.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md)

## A keyed memo reloads by pattern, all of it or part

On a keyed memo the two triggers live on the **factory**, that being what has an args space to
narrow over, and they take a pattern:

```ts shared
getInvoice.invalidate()               // every entry
getInvoice.invalidate({ id: '42' })   // one entry
getInvoice.refresh({ status: 'open' })   // every open invoice, loaded now
```

A pattern is a `Partial<Args>`, so it names a slice rather than a key. This is the one place args
granularity is spelled, and it is the place that has the `Args` type to check it against.

Read on: [Caching](load-once-per-set-of-arguments.md)

## A `Selection` names the entries to reload

The members above are conveniences over four free functions, and a `Selection` is what those take:

| A `Selection` is | Means |
| --- | --- |
| one `Reactive` | that value |
| one keyed memo | every args key of it |
| `{ tags: [...] }` | every entry carrying any of those tags, **across memos** |
| nothing | this scope |

```ts shared
import { invalidate, refresh, pending, refreshing } from 'abide'

invalidate(invoice)                     // ≡ invoice.invalidate()
invalidate({ tags: ['invoice:42'] })    // across every memo that tagged it
refresh(getInvoice)                     // every args key, loaded now
pending()                               // anything in this scope in flight
```

The member spellings are **defined as** these, not a second mechanism at a second width:
`s.refresh()` is `refresh(s)`, and `m.refresh(pattern)` is `refresh(m)` narrowed by args.

Two rules make the wide forms safe to reach for.

**Naming reaches anything; sweeping reaches producers.** Naming a `Reactive` by hand is the app
saying so about that one value, which is why the triggers are every `Reactive`'s. A bare
`invalidate()` matches only entries **with** a producer — a `state(0)` caught by a sweep is silent
data loss, and a room has nothing to re-run.

**A selection is scope-bounded**, as a memo is: this scope's entries plus `global` ones. So one
request can never invalidate another's. On a server that makes a bare `invalidate()` reach every
`global` memo in the process — its own request-scoped entries die with the request anyway, so the
globals are the whole effect. That is what an operator's flush endpoint wants and never what a
handler being defensive wants.

There is no bare form wider than the scope. A probe reports and a trigger acts, so the widest
read is free and the widest write is one an app should have to mean.

## A reconnect invalidates everything at once

At this width the lazy/eager difference stops being a nuance:

```abide #ui/pages/layout.abide — excerpt
<script>
import { online, watch, invalidate } from 'abide'

watch(() => { if (online) invalidate() })
</script>
```

A scope holding two hundred entries marks two hundred and loads the handful on screen.
`refresh()` would load all two hundred at the moment the network is least able to carry them,
which is why `invalidate()` is the reconnect default and `refresh()` is for warming data before
anyone asks.

Read on: [Offline](../app/know-when-the-browser-goes-offline.md) ·
[Watching values](do-something-when-a-value-changes.md)

## `ttl` expires a value with nobody asking

`ttl` is the life of a **retained production** — one definition reaching all three producers. At
the default retention a value holds one production, so past its `ttl` the producer recomputes on
the next read. A room retaining a hundred messages has a hundred, each on its own clock.

```ts #server/rpc/rates.ts — excerpt
const exchangeRate = memo(({ pair }: { pair: string }) => fetchRate(pair), {
    ttl: 60_000,
})
```

Expiry **wakes nobody**. Entries past it are dropped on the read that follows — no timer per
entry, no version bump — because a timer that moved the version would put the cost of retention
back on the write.

On an owned value there is no producer and nothing was loaded, so `ttl` is inert rather than
destructive: it never drops what an app put there. It still reaches a state that was **given** a
load, `state(fetchUser())` having a production to expire and `refresh()` to reload it.

Read on: [Local state](show-a-value-that-changes.md) ·
[History & tail](keep-the-last-few-values.md)

## `peek` reads without starting a load

Since reading is what loads, a read from somewhere that only wants to look is a subscription you
did not want. `peek` is the read that does not join the flow:

```ts shared
const draft = current.peek()   // same value, same load, no subscription
```

It is otherwise identical to a read — it starts work if there is work to start, and it throws
what a read throws. "Held, but do not load" is the probe in front of it, a probe never starting
work:

```ts shared
const shown = rate.success() ? rate.peek() : 'unknown'
```

`watch(sources, effect)` is the whitelist for the same problem; `peek` is the blacklist, and it is
what a memo has instead, having no `sources` form.

Read on: [Watching values](do-something-when-a-value-changes.md)

## Next

* [Caching](load-once-per-set-of-arguments.md) — where the entries being invalidated live
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — capping revalidation, however triggered
* [Mutations](../server/change-something-on-the-server.md) — invalidating after a write
