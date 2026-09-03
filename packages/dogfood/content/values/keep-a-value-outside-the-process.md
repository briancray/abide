---
title: Keep a value outside the process
nav: Persistence
intent: A value that survives a restart, a new tab, or a second instance.
covers:
  - state › `store`
  - memo › `store`
  - channel › `store`
  - `Store`
examples:
  - packages/dogfood/examples/persistence
---

Every `Reactive` so far has lived and died with its scope. A `store` says where its value lives
when the process does not — a cookie, `localStorage`, redis, a row somewhere — and it is one
option on the value rather than a mechanism beside it.

{% example persistence %}

*1 option, 0 markup changed* — the read and the write are the ones the page already had.

{% snippet persistence src/ui/pages/settings/page.abide const theme = state %}

## A store is two halves and your app writes both

`Store` is `{ get, set }`, and there is no way to spell either alone. A persister with no restore
is a `watch` under a longer name; a restore with no persister is the initial value `state` already
takes. Together they are one option, and what that buys is that the two cannot disagree about
where the value is.

{% snippet persistence src/shared/cookieStore.ts export function cookieStore %}

abide ships none of these. A store is where your own dependency goes, which is why it is an
interface and not a registry of backends.

A store runs where the `Reactive` is **constructed**, and in a `.abide` file that is both sides. A
store reaching something only one side has — `localStorage`, a database driver — is guarded there,
and what that costs is a first paint from the other side's answer and a correction at hydration.
A store both sides address renders right the first time, which `cookies()` is
answering on both sides above.

## `get` is a producer, so the triggers stop being inert

`s.refresh()` and `s.invalidate()` do nothing on a value you put a value into, there being nothing
to fetch. A store is the second way to give one a producer, and with one they mean what they mean
everywhere else:

```ts browser
theme.refresh()      // re-reads the store — another tab may have written it
```

`ttl` reaches it for the same reason. On a plain owned value `ttl` is inert rather than
destructive, because dropping it would lose something nothing can rebuild; with a store there is
somewhere to get it back from.

An unsettled `get` is a load like any other — `pending()` while it is in flight, a sink opened,
the value served when it lands. A **synchronous** `get`, which `localStorage` and a cookie
allow, is not a load at all: the value is there at construction, so nothing is pending and there
is no first paint of the fallback. Reload the example above and watch for it: dark on the first
frame, with no light one before it.

Read on: [Reloading](decide-when-a-value-reloads.md)

## A store answers before the initial value

`state('light', { store })` serves what the store had; `'light'` is what a **miss** falls back to.
Any other order and the line would not mean what it reads as.

## `set` runs per production

Not per write, per production — so a write `identity` collapsed is never persisted, and per the
unit rule a stream is written **once at close**, with the accumulation and never a partial.

Writes **coalesce latest-wins**: one in flight, one pending, and a third replaces the pending one.
A store handed an intermediate you have already superseded is doing work nobody can observe, and a
queue is how a slow store grows without bound behind a fast writer. It never blocks a reader — the
value is already held, and `set` is only how it leaves.

A `set` that fails does not tear the store off, unlike a `watch` effect that throws. A persister
that silently stopped is worse than none, so the failure reaches `onError`, warns on
`abide:reactive`, and the next production is written like any other.

`set` is handed the `Reactive`'s own `ttl`, in ms, so the number lives once on the value and the
store converts it:

{% snippet persistence src/server/redisStore.ts set: (value, { ttl }) => { %}

## A store in front of a body is a cache that survives a restart

Where the `Reactive` also has a body, the store sits in front of it: `get` on a cold entry, the
body on a miss, `set` on every production. That is the persistent form of the cache `ttl` already
bounds.

{% snippet persistence src/server/cache.ts export const flags = memo( %}

A deploy that restarts every instance no longer stampedes the thing behind it.

## One store per args key

A keyed memo builds one `Reactive` per args key, so a store keyed on anything has to be derived
**from** that key rather than closed over where the memo was declared. That is the function form,
and it is the one `tags` already uses:

{% snippet persistence src/server/cache.ts export const user = memo( %}

Closing over one key instead gives every entry the same store, and they clobber each other
silently.

Read on: [Caching](load-once-per-set-of-arguments.md)

## A restore is a write from another source

A store is over `Accepted` — what goes **in** — not over `Stored`. So what `get` answers with
passes `schema` and then `transform` exactly as a `set` does, and it mints a production. Nothing
downstream can tell a restored value from a written one, and a value stored before a deploy that
tightened the schema is checked on the way back in rather than trusted.

A streaming producer is the one arm where a restore is more than one production. Its `Accepted` is
`Chunk[]`, which is elementwise its own ring, so the restore seeds the ring with the elements and
`transform` runs on them at close as it would have live:

```abide abide
<!-- replays the chunks -->
{#for await token of answer({ messageId })}{token}{/for}

<!-- the joined value -->
{await answer({ messageId })}
```

Both read the same restored or live. Without that the entry would hold a value and an empty ring,
and one of those two lines would quietly render nothing.

A restored stream **finished**: `done()` and `success()` are true and `streaming()` is false. What
it costs is that the chunks get persisted rather than the transformed value, so a
`transform` that shrinks a lot pays for the big shape.

Read on: [History & tail](keep-the-last-few-values.md)

## Two processes, one cache — and what does not cross

A `store` on a `global` memo is a cache two processes share, and it is the one place anything in
this design crosses a process boundary. It is your dependency doing that, not abide.

What crosses is a **settled value and never a production**. An answer one instance finished is
served to one that never computed it; an in-flight stream's chunks do not reach it at all, `set`
running once at close. So it removes the duplicate work, not the duplicate connection.

## A room's store is its latest message

A channel's `Accepted` is one `Message`, so a store round-trips the standing message and never the
tail. For a roster or a status that is exactly right — a restart restores the last one instead of
showing an empty room until somebody publishes:

{% snippet persistence src/server/sockets/presence.ts export const roster = channel %}

`identity: structural` and the store read together here: a republished identical roster is not a
production, so it is not written either.

A transcript is the case this is **not** for. Putting a store on a chat channel persists one
message. History past the ring is app data behind an ordinary rpc, and the cursor joins
the two without a gap — `tail()` replays the ring before it goes live, so the two overlap.

Read on: [Rooms](let-anything-publish-and-anything-read.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — the triggers a store makes live
* [Caching](load-once-per-set-of-arguments.md) — the entries a store sits in front of
* [Rooms](let-anything-publish-and-anything-read.md) — why a transcript is not a stored value
