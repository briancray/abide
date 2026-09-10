---
title: Slow down a value that changes too fast
nav: Throttle & debounce
intent: A search box that fires on every keystroke, without firing on every keystroke.
covers:
  - state › `throttle`
  - memo › `throttle`
  - channel › `throttle`
  - state › `debounce`
  - memo › `debounce`
  - channel › `debounce`
  - state › `identity`
  - `structural`
  - memo › `identity`
examples:
  - packages/dogfood/examples/cap-debounce
  - packages/dogfood/examples/cap-throttle
---

A filter box is the case where "reading loads it" stops being free. Bind the input to a state,
derive the figure from it, and you have declared one request per keystroke. Two options cap that,
and a third stops a value waking anybody when it did not really move.

## The two caps, and what they cap

Both cap **how often the value changes**, and both apply however the change was driven.

| | Fires |
| --- | --- |
| `throttle: n` | immediately, then at most once per `n` ms |
| `debounce: n` | once the changes stop for `n` ms |

Declaring both is a build error naming the value, there being no reading under which you meant one
of them. Every `Reactive` takes them, and what drives the change is the producer's business:

| The value | What moves it | What a window collapses |
| --- | --- | --- |
| a `memo` over a load | a trigger — a dependency, an `invalidate`, a `refresh`, a `ttl` lapsing | reloads |
| a `memo` over a stream | a chunk | recomputes |
| a `state` | a write | wakes |
| a `channel` | a publish | wakes |

## `debounce` waits for the changes to stop

{% example cap-debounce %}

*1 option, 0 markup changed* — it goes on the memo that pays the cost, and the probes did not move
either.

`debounce` is right where the intermediate values are not answers — a half-typed region being the
example the whole page is built on. Five keystrokes are one load rather than five, and **the count
already held stays on screen the whole time.**

That is the `refresh()` contract rather than a new one: inside the window the held value keeps
being served and `refreshing()` is true, so a figure does not blank between keystrokes and there is
no fourth probe to learn. A **first** load still reports `pending()`, there being nothing held to
serve — which is the dash the card passes through once, on its way to the first figure.

The hand-written arm is where the cost shows. The window is one timer, but it arrives with two
things beside it: the flag that keeps the held figure up, and the guard that stops an answer for a
region since typed past from landing on the page.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md)

## `throttle` fires first and then rate-limits

{% example cap-throttle %}

`throttle` is right where the value is being watched — a live count, a cursor position, anything
where the first update should be immediate and the **rate** is the problem. The tile takes the
first arrival at once, which is the half a debounce would have got wrong: a debounced feed that
never goes quiet shows nothing at all.

**Both figures are right at every moment a reader looks**, and only one of them cost a repaint per
arrival. That is why the card's spec counts paints rather than comparing the two numbers — the
value is identical either way, and the work is the whole claim.

A window **delays**, and does not itself drop. It collapses a batch into one delivery, so a cursor
over a capped room gets what the ring held in one go rather than one per frame, and a
`{#for await}` block keyed on the sequence number stays sound. For a plain read the batch is the
latest value, which is why the same rule looks like two behaviours.

`tail` decides what survives the batch, never the window. There is no second buffer behind a cap,
so a room capped at the default retention serves the latest message and loses the ones between it.
Raise `tail` where the ones between are the point.

Read on: [History & tail](keep-the-last-few-values.md) ·
[Rooms](let-anything-publish-and-anything-read.md)

## The cap belongs on the value, not at the call site

A value that must not join a stampede says so about itself, where the knowledge is — a tag-wide
`invalidate({ tags: ['invoice'] })` cannot know what else it matched, so it is the wrong place to
decide how hard any one entry may be hit.

The one read that ignores the cap is a `bind:`. The binding wrote the value, so it sees its own
write immediately while the rest of the page waits out the window — otherwise a throttled state
under `bind:value` would snap the text back under a typist between keystrokes.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Form binding](../templates/bind-a-form-to-state.md)

## `identity` wakes readers only when the value moved

The other half of "too fast" is a value that changes without changing, and no card on this page
shows it — because there is nothing to show. `identity` decides what counts as the same value, and
getting it wrong leaves the output right and the work wrong: nothing renders incorrectly, the page
just re-renders on every recompute.

**`structural` is the default** on a state and a memo, so an args object, a derived record or a
list rebuilt from the same rows collapses without being asked to. The comparison is spent against a
**wake** — and a wake is a re-render and a DOM mutation, which costs more than the walk that avoids
it. So it is not priced against zero; it is priced against the work it cancels.

It BAILS rather than guesses: a `Map`, a `Set`, a class instance, a cycle, and it answers "not
equal", so an indecisive comparison wakes readers instead of collapsing a change. `canonical` is
not this and is not an equality at all; it builds a memo KEY, which has to be stable across
processes and across sides, so it sorts, drops `undefined` and allocates a string.

Write `identity: (value) => value` to opt back out, and your own comparator where `structural`
bails on a shape you need compared. It takes either form: a **projection** compared with `!==`, or
a **comparator** answering directly. The second exists because "same length, same elements" cannot
be projected — a freshly built array is `!==` whatever is in it.

A state holding an object is the case you hit first. A form binding rewrites it per keystroke, a
`refresh()` on `state(fetchUser())` returns a structurally identical user, and a write through a
member path copies down the path. Each of them is a new reference for a value that did not move.

**A room is the one producer that defaults to the reference**, and that is a fact about what a
production means there rather than an exception. A publish is an EVENT, and two identical events
are two events. A state's or a memo's production is a VALUE, and two identical values are one.

Read on: [Rooms](let-anything-publish-and-anything-read.md) ·
[Derived values](derive-a-value-from-other-values.md)

## `identity` costs O(size) per production

Walking is O(size) per production — per `set`, per recompute, per publish — and it is the cost the
default accepts. A four-key record is 48 ns, and a hundred rows rebuilt over the same row
references is 373 ns because every shared element settles on the first check. Five thousand rows
all freshly built and all equal is 0.31 ms, which is the pathological end and still under 2% of a
frame. The walk that finds its difference at the last row is the one that pays without collecting.

It compares the **stored** value against the previous one, which is why it never runs per chunk — a
streaming producer has one stored value, materialised when it closes. It holds one token and not a
set, so uniqueness is against the previous stored value rather than against the tail, and raising
`tail` never makes a write dearer.

## Next

* [Caching](load-once-per-set-of-arguments.md) — the entries a cap applies to
* [History & tail](keep-the-last-few-values.md) — the other way an accumulating value gets expensive
* [Form binding](../templates/bind-a-form-to-state.md) — the input the filter came from
