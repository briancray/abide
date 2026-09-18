---
title: Show markup conditionally
nav: Conditionals
intent: Branch on a value, on whether something has landed, and on whether rendering it failed.
covers:
  - `{#if cond}`
  - `{#try}`
examples:
  - packages/dogfood/examples/try-region
---

Three questions a page asks about a value: is it true, has it landed, and did rendering it
fail. Two blocks answer them, because whether a value has landed is a condition like any other.
Each renders one branch, and the branch it renders is the only one in the document.

## The two blocks

| You write | Branches | Asks |
| --- | --- | --- |
| `{#if cond}` | `{:else if}`, `{:else}` | is it true |
| `{#try}` | `{:catch e}`, `{:finally}` | did rendering this fail |

Both are **render-time** structure rather than a filter over markup that exists anyway: the
branch not taken has no nodes. And both bind each reactive read in their subject **once for the
body**, so a condition mentioning a value three times is one subscription and one read.

**There is no `{#switch}`.** Matching one expression against several constants is a chain of
`{:else if}`, and a second spelling for it would be a second thing to learn, a second lowering
to keep correct and a second place a reader looks first. The chain reads a little longer and is
the only shape there is.

## Whether it has landed is an `{#if}`

There is no block for waiting. `{#if invoice.ready()}` is the branch that renders once there is a
value, and `{:else}` is what shows until then. A probe in the condition subscribes to that probe
alone, and `ready()` does not move for a reload in flight, so the branch stays mounted through a
`refresh()` and its body is **updated** when the new value lands rather than rebuilt.

Where the render should wait for the value instead of showing something in the meantime,
`{await invoice}` holds it — and over a stream, until the **close**. That is what a calculation
wants, where a half-arrived value is not a smaller answer but a wrong one.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[Streaming data](../server/send-data-as-it-arrives.md)

## `{#try}` is a boundary over a region

{% example try-region %}

A failure **replaces the whole body**, not the expression that raised it. That is the point of
drawing the boundary rather than guarding each hole: what a reader is left with is a message
where the region was, instead of a table with one cell missing and no explanation for it.

Where the boundary goes is therefore a decision about what stays useful without what failed. A
`{#try}` around a page is a page that disappears; around a panel, it is a panel that says why.

The throw is the render's own. Moved into a derived value it would reach no boundary: once a value
has landed, a recompute that throws leaves the last one being served (2.2), and the failure is
`error()`'s to report instead.

`{:finally}` runs on both paths, and it is markup rather than a callback — it is what stays on
screen either way.

Read on: [Error pages](../pages/show-a-page-when-something-fails.md) ·
[Failures](../server/refuse-a-request-and-say-why.md)

## Next

* [Lists](repeat-markup-over-a-list.md) — the block for many rather than one
* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — the probes these branch on
* [Expressions](put-a-value-in-the-markup.md) — a hole where a branch would be too much
