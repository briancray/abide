---
title: Share one value across components
nav: Sharing
intent: Two components far apart in the tree reading the same thing, with no prop threaded between them.
covers:
  - `state.share`
  - `Shared`
examples:
  - packages/dogfood/examples/share-agree
  - packages/dogfood/examples/share-winner
  - packages/dogfood/examples/share-scope
---

A player owns what is playing. The bar at the top shows it and every row in the library can
change it, and the list holding those rows has never heard of a track. The usual repair is a prop
threaded through the list that does not want one.

Where a value really is one thing for the whole app, **reach for a module first**: export the
value, import it wherever you read it, and you have it typed, with no key, no registry and no
lifetime of its own to reason about. `state.share` is for the value that is one thing per
*subtree* — the case a module cannot reach, because two shelves each want their own.

## The forms of `state.share`

`state.share` is get-or-create in the current scope, by key. One call, and the key is a literal.

| You write | What you get |
| --- | --- |
| `state.share(key, build)` | the value under `key`, built by `build` only if nobody above you had one |
| `state.share(key, build)` again | the same value, and this call's `build` never runs |
| `state.share(expression, build)` | a build error — the key is a literal or it is nothing |

What comes back is whatever the thunk built, which is an ordinary `Reactive` with no share-shaped
wrapper on it. `Shared` is the optional registry of key names, and both are in the
[`state` reference](../reference/state.md).

## Two components far apart read one value

{% example share-agree %}

*3 instances, 1 value, 0 props* — against a prop through the list, or a store module with a
lifetime of its own.

The page holds the key, so every instance below it finds that one on the way up and none of
their `build` thunks run — three rows and a bar, one value. The page declares it and hands
neither of them anything.

That is the case a prop cannot reach. Where a parent already has the value, hand it down — a plain
`T` prop is a **live read** of the caller's expression, so `title={track}` follows `track` and the
child re-renders without being reinstantiated. Reach for `state.share` when the path between the
readers is uninterested, and for a prop when the parent that owns the value is the one rendering
the reader.

Read on: [Components](../templates/reuse-a-piece-of-markup.md) ·
[Form binding](../templates/bind-a-form-to-state.md)

## `state.share` hands back the one that won

{% example share-winner %}

One call rather than a share-then-read pair, so there is no ordering hazard and no miss to define.
So **use the return value and no other name.**

Building the value outside the call and passing it in fails silently, which is what the third tile
is. The local name goes on being read by the module that made it while every other module reads
the shared one, and both are correct-looking — they even agree until somebody writes. Handing a
thunk instead keeps the loser's value from being built at all.

## `Shared` is your app's own registry of keys

`Shared` is your app's own registry, widened by declaration merging — and an **opt-in tightening**,
not a precondition. A key it declares is checked against it; a key it does not is inferred from the
thunk, so `state.share` works before you have written one.

```ts src/shared/shared.ts — excerpt
declare module 'abide' {
    interface Shared {
        nowPlaying: Reactive<string>
    }
}
```

The registry buys one thing: two modules cannot disagree about the value under one name. With the
key declared, a typo is a compile error and the value type follows from the key. Without one,
`state.share('scratch', () => state(0))` is a `Reactive<number>` inferred from what you built.

A **dynamic key is a build error**, declared or not, and that is deliberate rather than a
limitation to work around: a `channel`'s args are for a per-room value. It also keeps the set of
shared keys fixed by the source, so there is no runtime bound to enforce and nothing to refuse.

Read on: [Rooms](let-anything-publish-and-anything-read.md) ·
[Sockets](../server/keep-a-room-of-callers-in-sync.md)

## A shared value lives in the component that created it, and below

{% example share-scope %}

The scope is **the component instance and its descendants**. A key found on the way up is the one
you get; a key nothing above you holds is created where you asked for it. So each shelf creates
its own `queued`, the control below it finds that one rather than building a second, and neither
shelf can see the other's.

That scoping is what makes a short word safe as a key. A registry keyed process-wide would make
`queued` a name two unrelated parts of an app collide on in silence, and neither side could see
the collision.

So the scope is the choice. **One per subtree is `state.share`; one for the app is a module**, and
reaching for a key where a module would have done buys a registry, a literal to keep in step and a
scope to think about, in exchange for nothing.

A shared value is **never evicted within its scope**. It goes when the scope does and not before.
A `global` memo entry may be dropped early because it can be rebuilt — that is a cache miss — but
a shared value cannot be, and dropping one would orphan live readers that go on reading something
nobody can refresh.

Read on: [Caching](load-once-per-set-of-arguments.md)

## Next

* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — sharing across callers rather than components
* [Caching](load-once-per-set-of-arguments.md) — `global`, and why its rule runs the other way
* [Watching values](do-something-when-a-value-changes.md) — reacting to a shared value from anywhere
