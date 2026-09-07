---
title: Share one value across components
nav: Sharing
intent: Two components far apart in the tree reading the same thing, with no prop threaded between them.
covers:
  - `state.share`
  - `Shared`
examples:
  - packages/dogfood/examples/sharing
---

A page owns a currency. Every amount on it is rendered by a `Money` component, and the table
holding those components has never heard of a currency. The usual repair is a prop threaded
through the table that does not want one, or a store module with its own lifetime to reason
about.

`state.share` is get-or-create in the current scope, by key.

{% example sharing %}

*3 instances, 1 value, 0 props* — against a prop through the table, or a store module with a
lifetime of its own.

{% snippet sharing src/ui/components/Money.abide const currency = state.share %}

Every instance of `Money` runs that line and they all get the same value. Whichever one runs
first creates it; the rest get what is there.

## `Shared` is your app's own registry of keys

`Shared` is your app's own registry, widened by declaration merging — and an **opt-in tightening**,
not a precondition. A key it declares is checked against it; a key it does not is inferred from the
thunk, so `state.share` works before you have written one. What the registry buys is that two
modules cannot disagree about the value under one name.

{% snippet sharing src/shared/shared.ts declare module 'abide' { %}

With the key declared, a typo is a compile error and the value type follows from the key. Without
one, `state.share('scratch', () => state(0))` is a `Reactive<number>` inferred from what you built.

A **dynamic key is a build error**, declared or not, and that is deliberate rather than a limitation
to work around: a per-room value is what a `channel`'s args are for. It is also what keeps the set of
shared keys fixed by the source, so there is no runtime bound to enforce and nothing to refuse.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md)

## `state.share` hands back the one that won

One call rather than a share-then-read pair, so there is no ordering hazard and no miss to define.
The consequence is that **the return value is the only name to use**:

{% snippet sharing src/ui/pages/invoices/page.abide const currency = state.share %}

The page above and every `Money` instance ask for `currency` with a thunk that builds
`state('USD')`, and exactly one of those four thunks runs. Do not build the value outside the
call and pass it in. That fails silently: the local name goes on being read by the module that
made it while every other module reads the shared one, and both are correct-looking. The thunk is
what keeps the loser's value from being built at all.

## A shared value lives in the component that created it, and below

The scope is **the component instance and its descendants**. A key found on the way up is the one
you get; a key nothing above you holds is created where you asked for it. So two sibling subtrees
may each write `state.share('id', …)` for the row they are rendering, and neither can see the
other's.

Which is what makes the key safe to be a short word. A registry keyed process-wide would make
`'id'` a name two unrelated parts of an app collide on in silence, and neither side could see the
collision. Where a value really is one thing for the whole app, the language already has that: a
module exporting it and every reader importing it, typed, with no key at all.

A shared value is **never evicted within its scope**. It goes when the scope does and not before.
A `global` memo entry may be dropped early because it can be rebuilt — that is a cache miss — but
a shared value cannot be, and dropping one would orphan live readers that go on reading something
nobody can refresh.

Read on: [Caching](load-once-per-set-of-arguments.md)

## A prop beats sharing where the parent already has the value

Sharing is for values with no owner on the path between the readers. Where a parent already has
the value, hand it down: a plain `T` prop is a **live read** of the caller's expression, so
`count={total}` tracks `total` and the child re-renders without being reinstantiated.

The example above is the case that cannot: `InvoiceTable` sits between the page and the three
instances and has no currency to pass, so a prop would mean giving it a parameter it exists to
not have. Reach for `state.share` when the path is uninterested, and for a prop when the parent
that owns the value is the one rendering the reader.

Read on: [Components](../templates/reuse-a-piece-of-markup.md) ·
[Form binding](../templates/bind-a-form-to-state.md)

## Next

* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — sharing across callers rather than components
* [Caching](load-once-per-set-of-arguments.md) — `global`, and why its rule runs the other way
* [Watching values](do-something-when-a-value-changes.md) — reacting to a shared value from anywhere
