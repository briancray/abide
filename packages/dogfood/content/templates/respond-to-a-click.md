---
title: Respond to a click
nav: Events
intent: Handle an event, and get hold of the element it happened on.
covers:
  - `on<event>={fn}`
  - `bind:element={Reactive<Element> | ((element: Element) => void | Disposer)}`
examples:
  - packages/dogfood/examples/element-ref
---

An event handler is an attribute whose value is a function. There is no synthetic event system
underneath it and no delegation to reason about: `onclick={save}` adds a native listener to
that element, and removing the element removes it.

## The two spellings

| You write | What you get |
| --- | --- |
| `on<event>={fn}` on an element | a native listener, added on mount and removed with the node |
| `on<event>={fn}` on a component | an ordinary prop, named `onwhatever` |
| `bind:element={ref}` | the node itself, in a `Reactive` |
| `bind:element={(el) => …}` | the node itself, in a callback that may return a `Disposer` |

`on<event>` on a **component** is not an event at all — it is a prop that happens to be named
`onsave`, and the component decides what to do with it. That is one rule rather than two: a
capitalised tag is a component, so what looks like an event on one is what every other prop on
one is.

## The element, when the value is not enough

{% example element-ref %}

*1 binding, 0 selectors* — the arm's is a string in one file matching an `id` in another.

Most of a page never needs a node. The handful of things that do — focus, `scrollIntoView`, a
measurement, a canvas, a third-party widget — need the real element and nothing standing in
for it, and `bind:element` is how it arrives.

It takes either a `Reactive` of an element or a callback. The callback form may return a
`Disposer`, which is what a third-party widget wants: set it up when the node arrives, tear it
down when the node goes. The two are written next to each other, rather than in a pair of
lifecycle hooks that have to be kept in step.

Read on: [Values by name](read-and-write-a-value-by-name.md) ·
[Watching values](../values/do-something-when-a-value-changes.md)

## A handler does not track

Whatever a handler reads while it runs subscribes to nothing. That is deliberate, and it is the
same rule a `bind:` write-back is under: a handler runs because something happened, not because
a value moved, so a read inside one is a read and never a subscription.

It means a handler can read anything it likes without accidentally arranging to be re-run. The
place that arrangement belongs is a `memo` or a `watch`, where it is what you asked for.

Read on: [Derived values](../values/derive-a-value-from-other-values.md)

## Measuring is a layout read, and it has a cost

A `getBoundingClientRect` after a write forces the layout that write invalidated. One such read
per row is the whole frame, so batch the reads before the writes, or take the measurement once
outside the loop.

That is a browser cost rather than an abide one, and `bind:element` neither adds to it nor
hides it. What it removes is the lookup.

## Next

* [Form binding](bind-a-form-to-state.md) — the events an input handles for you
* [Components](reuse-a-piece-of-markup.md) — where `onsave` is a prop rather than an event
* [Watching values](../values/do-something-when-a-value-changes.md) — running code when a value moves
