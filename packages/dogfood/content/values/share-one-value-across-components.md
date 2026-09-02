---
title: Share one value across components
nav: Sharing
intent: Two components far apart in the tree reading the same thing, with no prop threaded between them.
covers:
  - `state.share`
  - `Shared`
---

A header shows an unread count. A settings panel five levels down turns notifications off. They
need the same value, and nothing on the path between them cares about it — so the usual repair is
a prop threaded through every level, or a store module with its own lifetime to reason about.

`state.share` is get-or-create in the current scope, by key.

```abide #ui/components/UnreadBadge.abide
<script>
import { state } from 'abide'

const unread = state.share('unread', () => state(0))
</script>

{#if unread > 0}<span class="badge">{unread}</span>{/if}
```

*1 key, 0 props threaded* — against a prop through every level, or a store module with a
lifetime of its own.

Any other component calling `state.share('unread', …)` gets that same value. Whichever one runs
first creates it; the rest get what is there.

## `Shared` is your app's own registry of keys

`Shared` is your app's own registry, widened by declaration merging — and an **opt-in tightening**,
not a precondition. A key it declares is checked against it; a key it does not is inferred from the
thunk, so `state.share` works before you have written one. What the registry buys is that two
modules cannot disagree about the value under one name.

```ts #shared/shared.ts
declare module 'abide' {
    interface Shared {
        unread: number
        draft: string
    }
}
```

With the key declared, a typo is a compile error and the value type follows from the key. Without
one, `state.share('scratch', () => state(0))` is a `Reactive<number>` inferred from what you built.

A **dynamic key is a build error**, declared or not, and that is deliberate rather than a limitation
to work around: a per-room value is what a `channel`'s args are for. It is also what keeps the set of
shared keys fixed by the source, so there is no runtime bound to enforce and nothing to refuse.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md)

## `state.share` hands back the one that won

One call rather than a share-then-read pair, so there is no ordering hazard and no miss to define.
The consequence is that **the return value is the only name to use**:

```ts shared
const message = state.share('draft', () => state(''))   // right
```

Building the value outside the call and passing it in is what makes this go wrong silently — the
local name goes on being read by the module that made it while every other module reads the
shared one, and both are correct-looking. The thunk is what keeps the loser's value from being
built at all.

## A shared value lives in the scope a memo's cache lives in

The scope is the one a memo's default scope is: **request-local on a server, process-local in a
browser**, where there is one caller and no request. Same callable, same name, same intent; what
differs is only what a caller is on each side.

So caller-specific data is exactly what belongs in one — which is the opposite of a `global`
memo's warning, and it is bounded by its scope rather than by a policy. On a server that makes it
what a page render uses to share a value between two components without threading a prop through
every level between them.

A shared value is **never evicted within its scope**. It goes when the scope does and not before.
A `global` memo entry may be dropped early because it can be rebuilt — that is a cache miss — but
a shared value cannot be, and dropping one would orphan live readers that go on reading something
nobody can refresh.

Read on: [Caching](load-once-per-set-of-arguments.md)

## A prop beats sharing where the parent already has the value

Sharing is for values with no owner on the path between the readers. Where a parent already has
the value, hand it down: a plain `T` prop is a **live read** of the caller's expression, so
`count={total}` tracks `total` and the child re-renders without being reinstantiated.

Reach for `state.share` when the path is long and uninterested, and for a prop when it is short
and the parent owns the value.

Read on: [Components](../templates/reuse-a-piece-of-markup.md) ·
[Form binding](../templates/bind-a-form-to-state.md)

## Next

* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — sharing across callers rather than components
* [Caching](load-once-per-set-of-arguments.md) — `global`, and why its rule runs the other way
* [Watching values](do-something-when-a-value-changes.md) — reacting to a shared value from anywhere
