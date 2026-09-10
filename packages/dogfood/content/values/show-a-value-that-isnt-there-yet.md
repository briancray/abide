---
title: Show a value that isn't there yet
nav: Loading states
intent: Render before the data lands, and know the difference between empty, loading, reloading and failed.
covers:
  - `s.pending`
  - `s.refreshing`
  - `s.done`
  - `s.success`
  - `s.streaming`
  - `pending`
  - `refreshing`
  - `s.error`
  - `s.then`
  - `s.catch`
  - `s.finally`
examples:
  - packages/dogfood/examples/probe-hole
  - packages/dogfood/examples/probe-refresh
  - packages/dogfood/examples/probe-derived
  - packages/dogfood/examples/probe-error
---

The usual shape of this is a loading flag, an error branch and a value, kept in step by hand —
three variables that can disagree, and usually do on the reload. Here the value carries all three,
and the ordinary page branches on none of them.

## The probes

A probe answers about the load without reading the value. **A probe never throws and never starts
work**, so it is safe in a branch that runs before anything has arrived.

| Probe | True when |
| --- | --- |
| `pending()` | a load is in flight and there is nothing trustworthy to show |
| `refreshing()` | an update is owed over a value still being served |
| `done()` | it finished, however it finished |
| `success()` | there is a landed value to serve |
| `streaming()` | it is currently producing chunks |
| `error()` | hands back the standing refusal — what the last write or production was refused with |

`pending` and `refreshing` also have **free** forms that take a selection. Every signature is in
the [`Reactive` reference](../reference/reactive.md).

## A read starts the load and leaves a hole

{% example probe-hole %}

*1 read, 0 loading branches* — against a loading flag, an error branch and a value kept in step by
hand.

Reading is the whole subscription — there is no mount hook to put the load in and no `load()` to
call. That page has no loading branch in it: the read starts the load, the document goes out with
a hole where `invoice.number` was, and the hole fills when the row lands. What a read gives back
depends only on where the value has got to:

| The value is | A read gives you |
| --- | --- |
| landed | the value |
| pending — its own load, or one it derives from | what it has, `undefined` where nothing landed, and a sink opens where it was read |
| a producer failed with nothing landed | it throws, to the nearest `{#try}` or to `error.abide` |
| holding a refusal over a value | the last accepted value; `error()` carries the refusal |

Member access on a `Reactive` short-circuits, so an in-flight `invoice.total` is `undefined` rather
than a TypeError, and the whole chain after it goes with it. That makes `{data.name ?? 'Loading'}`
and `{#for stat of data.stats ?? []}` read the same way — an `{#for}` over `undefined` iterates
zero times.

The sink is opened by `pending()` rather than by an absent value, and the difference shows on a
derived memo. Such a memo holds a **provisional** value built from a source still in flight, so
keying the hole on absence would flush that provisional value as the answer and never correct it.

*By default*, because a read can be made to hold on purpose — `{await invoice}` is that opt-in.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Expressions](../templates/put-a-value-in-the-markup.md)

## `pending()` is the first load; `refreshing()` is every one after

{% example probe-refresh %}

`pending()` tells `undefined`-because-in-flight from a value that genuinely resolved to
`undefined`. And `done()` and `success()` **stay true through a `refresh()`** — the load that
finished still finished — so `refreshing()` is the only one that moves on a reload. A spinner reads
`refreshing()`; a table keeps rendering the rows it already has.

One boolean cannot tell those apart, which is why the hand-written arm carries two: a first load
has nothing to show and a reload has, so a single flag blanks the table every time somebody presses
Refresh.

An `invalidate()` is the other story: what follows it is not a reload but a first load over a value
the app called wrong, so `pending()` goes true and `done()` goes false with it.

`success()` and `error()` are **orthogonal, not opposite**. One asks whether there is a value to
show, the other whether the last write or production was refused, and a refused write over a landed
value answers yes to both — which leaves a bound input on screen beside its own message. An
accepted write clears the refusal.

Reading a probe subscribes you to **that probe alone**. A value change does not wake a
`refreshing()` reader, and a `refreshing()` flip does not wake a value reader, which is why the
spinner and the table do not re-render each other.

Read on: [Reloading](decide-when-a-value-reloads.md)

## A derived value is pending while what it reads is

{% example probe-derived %}

An unkeyed `memo` answers `pending()` for **its own load or any value its body read**. Without
that, a memo deriving from a value still in flight is quietly wrong: the filter runs happily over
nothing, returns `[]`, and reports `success()` — a page rendering "0 unpaid" with nothing pending
and nothing failed, for the length of the load.

It is the same **any, not all** question a selection asks, over the set the memo already tracks in
order to recompute. The answer is taken on the read that asks for it, walking those sources — no
subscription per source, the list being the one tracking already keeps. Depth is the chain, not the
whole graph.

Deriving it at the recompute instead would miss the case it is most wanted for. An `invalidate()`
drops a source's cache without changing its value and without sending a request, so nothing
recomputes, and a count taken at the last recompute reads false for the whole reload window.

`refreshing()` and `done()` follow on the same walk. Those three are the probes about whether a
value is ready, and readiness is downstream of the sources. The other three answer for the memo
alone: `error()` cannot propagate because `Failures` does not, `streaming()` would be false where a
memo yields one value per recompute rather than chunks, and `success()` is orthogonal to a load in
flight by design.

Two ways to ask for the hole instead of the wait. Read the **probe** rather than the value —
`rows.pending()` subscribes to that probe and is not a read of the value, so it never makes its own
reader pending. Or `peek()`, which is already reading without joining the flow. A failure needs
none of this: a source with nothing to serve throws on the read, so the body fails with it and the
failure is the memo's own. A **keyed** memo propagates nothing, its body being untracked.

Read on: [Derived values](derive-a-value-from-other-values.md)

## `error()` hands the failure back instead of throwing

{% example probe-error %}

A first load that failed has no value, so the read throws and the failure reaches the nearest
`{#try}` or `error.abide` without every call site checking. Escalating is the default, and this
is how a page declines it: read the failure off the value and render a message instead. The retry
clears it, which is the half a hand-kept third variable forgets.

A **refused write** never throws, whatever is standing: the gates refused something going in, and a
read waits on a producer. A **failed reload** leaves the held value being served, so it does not
throw either. Neither unmounts `{:then}`, which is why `{:catch}` is bound to a producer that
failed with nothing landed rather than to `error()` alone. The cost of that is a failed reload
nothing escalates: it fills `error()`, warns on `abide:reactive`, and is otherwise invisible until
something reads it.

`isError` narrows a caught failure by name, and `.data` is typed to what that failure declared.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Error pages](../pages/show-a-page-when-something-fails.md)

## Every `{#await}` branch is bound to a probe

`{#await}` is the spelled-out form of the same four questions, and each branch is bound to a probe
rather than to settledness:

| Branch | Probe |
| --- | --- |
| the body | `pending()` |
| `{:then}` | `success()` |
| `{:catch}` | a producer that failed with nothing landed |
| `{:finally}` | `done()` |

Two consequences worth having in front of you. `{:finally}` renders **alongside** whichever of the
other two is mounted rather than replacing it, the way a `finally` runs after both. And because
`success()` survives a reload, `{:then}` stays mounted through a `refresh()` and its body is
**updated** when the new value lands rather than rebuilt — a destructured `{:then { total }}` stays
live for the same reason.

There is no state in which none of the branches is mounted. A value with no producer has landed at
construction, and a stream reports `pending()` until it **closes** rather than until its first
chunk — so nothing falls between them.

## `await` is how a read holds on purpose

Not blocking is the default; holding is the opt-in. `await` governs the whole **expression**, not
the name — every reactive read inside it blocks — and the reads are started before they are
awaited, so `{await a.x + b.y}` is one round trip rather than two loads serialized behind one hole.

Set against a plain read, **the tell is whether there is a pending body**:

| Form | Holds |
| --- | --- |
| `{invoice}` | no — the read renders nothing and opens a sink the value fills later |
| `{await invoice}` | yes |
| `{#await invoice then row}` | yes — there is no pending branch, so there is nothing to render instead |
| `{#await invoice}{:then row}` | no — the pending body renders while it loads |

So `then` on the opening tag is not shorthand for the same block. It is the deliberate wait, and it
trades away the branch that would have covered the wait. `{:catch}` and `{:finally}` still attach.
The binding takes a name or a destructuring pattern — `then { total }` — and stays live either way,
so the body is **updated** when the value moves rather than rebuilt.

Either spelling holds over a stream until the stream **closes**, the same way it holds until a
value settles. A source that never closes holds forever; that is the author's to resolve.

Read on: [Conditionals](../templates/show-markup-conditionally.md)

## On a server the value carries its own `await`

A handler has no template to spell `{await}` in, so the value carries the wait itself. `await
invoice` waits for the value to settle, and `then`, `catch` and `finally` reach that same promise
by hand. Nothing about the read changes: `invoice()` still returns what has landed and
never blocks, and the `await` is the opt-in here exactly as it is in a template.

`catch` fires for a producer that failed with nothing landed, which is the one case a read throws
for. A refused write and a failed reload both fill `error()`, and neither reaches `catch` any more
than either reaches `{:catch}`.

`finally` is about the **settling**, not the value. A room settles at its first message and then
keeps going, so `finally` runs while the room is still live.

The value is a promise in the places JavaScript looks for one, so returning it from a handler hands
back what it settled to. Nested in a returned object it is still a `Reactive`, which the compiler
refuses — a member that would serialize to nothing.

## The free probes answer over a selection

The probes above are one value's. The free forms take a **selection** and answer over a set — one
memo, or every entry carrying a tag, or the whole scope when you pass nothing. Bare, that is
anything in flight in this scope, which is what an app-wide progress strip wants.

Only these two probes have a free form, because **any, not all** is the one question that
aggregates without a second rule. `done()` and `success()` over a set are genuinely ambiguous
between the two, and an aggregate `error()` would have to pick a failure to hand back.

A selection holds **one signal**, bumped when the count of matching in-flight entries crosses zero.
Ten entries reloading together wake that strip twice, not twenty times.

Read on: [Reloading](decide-when-a-value-reloads.md) ·
[Caching](load-once-per-set-of-arguments.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — `invalidate` against `refresh`, over one value or many
* [Streaming data](../server/send-data-as-it-arrives.md) — chunks, and what `streaming()` reads
* [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) — how the hole reaches the browser
