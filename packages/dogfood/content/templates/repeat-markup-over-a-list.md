---
title: Repeat markup over a list
nav: Lists
intent: Render a list so that reordering it moves nodes instead of rebuilding them.
covers:
  - `{#for item, index of list by key}`
  - `by`
examples:
  - packages/dogfood/examples/list-keyed.json
  - packages/dogfood/examples/list-by.json
---

A list block renders its body once per item. What separates one implementation from another is
not the first render — every one of them produces the same markup — but the second: whether a
reorder moves the nodes that were already there, or builds new ones that look the same.

## One list block

| You write | Over |
| --- | --- |
| `{#for item, index of list by key}` | a collection you hold |
| `{#for item of iterable}` | an async iterable, as it produces |

`index` and `by` are both optional, and the second is the one worth spelling. The subject is
read like any other name, so `{#for row of rows}` walks the array `rows` holds, and walks it again
each time that array changes — a value a followed `GET` keeps current included.

It iterates **zero times** over an absent subject. A list still loading is not an error and
not a special case; it is a block with nothing in it yet.

## A key is what makes a reorder a reorder

{% example list-keyed %}

*1 clause, 0 tables* — the arm's key-to-node map is what `by` says in four characters.

Without `by`, a `{#for}` is **positional**: item one is the first node, item two the second,
and a list whose order changed is a list where every node's content changed. The output is
identical, which is exactly the problem — a rebuild renders correctly and throws away the
focus, the selection, the scroll position and any transition that was mid-flight.

That is why the block **warns in development** where it has no key and a stateful body. A body
holding an input or a component instance is a body where the difference is visible, and the
warning is the only moment anything says so.

A key is any expression, and the honest one is whatever the row is identified by in the system
it came from. `by row.id` and `by row` differ only in whether identity survives a re-fetch.

Read on: [Patching a list](../values/patch-a-list-from-a-live-feed.md)

## A value can carry its own key

{% example list-by %}

*1 option, 2 tables* — the arm keeps a key-to-node map per list, and `by: 'id'` on the value is
both of them.

Where one list is rendered in more than one place, the key belongs to the value rather than to
each block that walks it. `by` on the `reactive` names what tells two elements apart — a property,
or a function of the element — and a `{#for}` that writes no key of its own takes it.

It reaches a block whose subject is the value **named alone**. `{#for c of contacts.slice(0, 3)}`
walks a new array computed from the value, which declared no key, so that block is positional
again and writes `by c.id` itself. A key the block writes wins over the value's.

`by` is not `identity`. `identity` decides whether the whole value changed, and `by` decides
which row is which once it has.

## Two cases catch two different mistakes

A **two-row swap** is what tells a minimal reorder from a rebuild: both render the same names,
and only one of them moved two nodes to do it. A **full reverse** cannot — every position
changed, so a rebuild and a reorder are indistinguishable by cost.

The reverse earns its place on the other question. A transposition that gets the ends right and
the middle wrong passes a swap and fails a reverse, so the case that is useless for pricing is
the one that catches the bug. Both, or neither is worth running.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md)

## Over an async iterable, the same block appends

A subject that is an async iterable and not also iterable — an async generator, say — produces over
time, and the block appends each item as it lands rather than waiting for the last, reconciling
nothing (32.15).

A channel is not that case. It is a `reactive` holding an array, so `{#for m of room}` reads the
array and reconciles it as messages are appended and the front is trimmed. With `by: 'id'` on the
value, each message moves one row (32.32); without it the rows are positional, and trimming the
front rebuilds every one.

Read on: [Streaming data](../server/send-data-as-it-arrives.md) ·
[Channels](../values/let-anything-publish-and-anything-read.md)

## Next

* [Conditionals](show-markup-conditionally.md) — the block for one rather than many
* [Components](reuse-a-piece-of-markup.md) — a row that is worth its own file
* [Patching a list](../values/patch-a-list-from-a-live-feed.md) — changing one row of many
