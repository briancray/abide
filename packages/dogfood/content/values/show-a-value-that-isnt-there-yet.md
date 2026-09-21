---
title: Show a value that isn't there yet
nav: Loading states
intent: Render before the data lands, and know the difference between empty, loading, reloading and failed.
covers:
  - `s.busy`
  - `s.ready`
  - `NotLanded`
  - `busy`
  - `ready`
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
| `busy()` | work is in flight — a first load, a reload, or a stream that has not closed |
| `ready()` | there is a value to serve |
| `error()` | hands back the standing refusal — what the last write or production was refused with |

Two booleans, four states, and the states an interface actually shows are the combinations:

| The state | Reads as |
| --- | --- |
| loading, nothing to show | `busy() && !ready()` |
| reloading over a value on screen | `busy() && ready()` |
| finished, whichever way | `!busy()` |
| nothing landed and nothing in flight | neither |
| marked stale by `invalidate`, before a read runs the producer | `ready()` — still served (7.17) |

`busy` and `ready` also have **free** forms that take a selection. Every signature is in
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
| busy with nothing to serve — its own load, or one it derives from | it throws `NotLanded`, and a sink opens where it was read |
| a producer failed with nothing landed | it throws, to the nearest `{#try}` or to `error.abide` |
| holding a refusal over a value | the last accepted value; `error()` carries the refusal |

A read of a value with nothing landed throws `NotLanded` (2.10), and inside a tracked body that
throw **aborts the body** rather than letting it branch on an absence (2.13). The body runs again
when the value lands (2.14). So `{data.name ?? 'Loading'}` never shows `Loading`: the read throws
before `??` is reached, and the compiler warns and names `ready()` (14.17). Ask the probe instead —
`{data.ready() ? data.name : 'Loading'}`.

The sink is opened by `busy()` with nothing to serve, rather than by an absent value, and the
difference shows on a derived value. Its body aborts on a source still in flight (2.13) and mints
nothing (11.53), so it is absent for a moment that says nothing about the answer — and `busy()` is
what says one is on its way (11.21).

*By default*, because a render can be made to hold on purpose — an `await` in the component's
`<script>` is that opt-in.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Expressions](../templates/put-a-value-in-the-markup.md)

## The first load and every one after are `ready()` apart

{% example probe-refresh %}

Both states are busy. What separates them is whether there is anything on screen to keep: a first
load is `busy() && !ready()` and a reload is `busy() && ready()`, because **`ready()` does not move
for a load in flight**. A spinner reads the conjunction; a table keeps rendering the rows it
already has.

One boolean cannot tell those apart, which is why the hand-written arm carries two: a first load
has nothing to show and a reload has, so a single flag blanks the table every time somebody presses
Refresh.

An `invalidate()` is the other story: it says what is held is **wrong**, not merely stale, and it
runs nothing (7.3). Nothing a reader can see moves until the next read (7.14, 7.17), and that read
stops serving what is held and loads with nothing underneath (7.8) — a first load again. That is the
whole difference between the two triggers, and it is the one a reader can see.

`ready()` and `error()` are **orthogonal, not opposite**. One asks whether there is a value to
show, the other whether the last write or production was refused, and a refused write over a landed
value answers yes to both — which leaves a bound input on screen beside its own message. An
accepted write clears the refusal.

Reading a probe subscribes you to **that probe alone**. A value change does not wake a `busy()`
reader, and a `busy()` flip does not wake a value reader, which is why the spinner and the table do
not re-render each other.

Read on: [Reloading](decide-when-a-value-reloads.md)

## A derived value is busy while what it reads is

{% example probe-derived %}

A derived value answers `busy()` for **its own load or any value its body read** (11.21). Its body
never runs over nothing: reading `rows` before the list lands throws and abandons the run (2.13),
so the count is absent rather than a confident "0 unpaid". Absent says nothing about why, and the
probes do — `busy()` says an answer is on its way, and `ready()` holds off until everything the
body read has landed (11.59).

It is the same **any, not all** question a selection asks, over the set the body already tracks in
order to recompute. The answer is taken on the read that asks for it, walking those sources — no
subscription per source, the list being the one tracking already keeps. Depth is the chain, not the
whole graph.

Deriving it at the recompute instead would miss the case it is most wanted for. A `refresh()`
reloads a source while its value stands (7.4), so nothing recomputes, and a count taken at the last
recompute reads false for the whole reload window. An `invalidate()` sends nothing (7.3), and the
window opens on the read of the derived value, which runs the source's producer first (7.13).

`busy()` and `ready()` are the probes that propagate (11.20): a derived value is busy where anything
it read is busy, and ready only where everything it read is (11.59). `error()` does not, because
`Failures` does not — a read inside a body widens no union, so a propagated refusal would sit
unnarrowable at every reader. Adoption is the other case: a body handing back a `Reactive` forwards
every probe, `error()` included (11.51).

Two ways to ask for the hole instead of the wait. Read the **probe** rather than the value —
`rows.busy()` subscribes to that probe and is not a read of the value, so it never makes its own
reader busy. Or `peek()`, which is already reading without joining the flow. A failure needs
none of this: a source that failed with nothing landed throws on the read (2.2), so the body fails
with it and the failure is the derived value's own. A **keyed** value propagates nothing, its body being
untracked (11.23).

Read on: [Derived values](derive-a-value-from-other-values.md)

## `error()` hands the failure back instead of throwing

{% example probe-error %}

A first load that failed has no value, so the read throws and the failure reaches the nearest
`{#try}` or `error.abide` without every call site checking. Escalating is the default, and this
is how a page declines it: read the failure off the value and render a message instead. The retry
clears it, which is the half a hand-kept third variable forgets.

`invoice` adopts the call, and every probe forwards through an adoption, `error()` included
(11.51), so the handler's refusal is `invoice.error()`. The Retry reaches the load it adopted
(11.52).

A **refused write** never throws, whatever is standing: the gates refused something going in, and a
read waits on a producer. A **failed reload** leaves the held value being served, so it does not
throw either. Neither takes away what `ready()` answered, which is why escalation is bound to a
producer that failed with nothing landed rather than to `error()` alone. The cost of that is a failed reload
nothing escalates: it fills `error()`, warns on `abide:reactive`, and is otherwise invisible until
something reads it.

`isError` narrows a caught failure by name, and `.data` is typed to what that failure declared.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Error pages](../pages/show-a-page-when-something-fails.md)

## `await` is how a render holds on purpose

Not blocking is the default; holding is the opt-in, and the `<script>` is where it is spelled.
`const invoice = await getInvoice()` leaves `invoice` the value it always was — the `await`
answers the value itself, not what it holds — and holds this component's render until it settles.

Set against a plain read, **the tell is the `await`**:

| Form | Holds |
| --- | --- |
| `const invoice = getInvoice()` | no — the read renders nothing and opens a sink the value fills later |
| `{#if invoice.ready()}` | no — the `{:else}` renders while it loads |
| `const invoice = await getInvoice()` | yes — the whole component waits |

Two of them side by side settle **together**, not one after the other; one that reads what the
other is bound to is the exception, and that pair settles in the order you wrote it.

`await` holds over a stream until the stream **closes**, the same way it holds until a value
settles. A source that never closes holds forever; that is the author's to resolve.

Read on: [Conditionals](../templates/show-markup-conditionally.md)

## On a server the value carries its own `await`

It is the same `await` a handler writes, the value carrying the wait itself. `await invoice`
resolves where `invoice.busy()` becomes false (2.8), and `then`, `catch` and `finally` reach that
same promise by hand. Awaited mid-refresh it gets what the refresh lands, and awaited
over a stream it gets the whole accumulation at close. Nothing about the read changes: `invoice()` still returns what has landed and
never blocks, and the `await` is the opt-in here exactly as it is in a template.

`catch` fires for a producer that failed with nothing landed, which is the one failure a read
throws (2.9). A refused write and a failed reload both fill `error()`, and neither reaches `catch`.

`finally` is about the **settling**, not the value. A subscriber's copy of a channel settles at the
first production to arrive and then keeps going (9.29, 2.8), so `finally` runs while it is still live.

The value is a promise in the places JavaScript looks for one, so returning it from a handler hands
back what it settled to. Nested in a returned object it is still a `Reactive`, which the compiler
refuses — a member that would serialize to nothing.

## The free probes answer over a selection

The probes above are one value's. The free forms take a **selection** and answer over a set — one
value, one keyed value, or every entry carrying a tag, or the whole scope when you pass nothing. Bare, that is
anything in flight in this scope, which is what an app-wide progress strip wants.

Only these two have a free form. `busy` asks whether ANY entry is in flight and `ready` whether
EVERY entry has a value (13.2, 13.11), and an aggregate `error()` would have to pick a failure to hand
back.

A selection holds **one signal**, bumped when the count of matching in-flight entries crosses zero.
Ten entries reloading together wake that strip twice, not twenty times.

Read on: [Reloading](decide-when-a-value-reloads.md) ·
[Caching](load-once-per-set-of-arguments.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — `invalidate` against `refresh`, over one value or many
* [Streaming data](../server/send-data-as-it-arrives.md) — chunks, and when a stream reads as ready
* [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) — how the hole reaches the browser
