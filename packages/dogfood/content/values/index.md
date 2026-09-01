---
title: Reactive values
nav: Overview
intent: Four ways to declare a value, and the one type all four hand back.
---

Four ways to declare a value. **One type back** — every one of them is a `Reactive`,
so everything below reads the same.

| You write | The value comes from |
| --- | --- |
| `state(0)` | you |
| `memo(() => a + b)` | other values |
| `memo(() => getThing({ id }))` | your server |
| `channel()` | someone else |

```ts shared
const draft = state('')
const words = memo(() => draft().split(' ').length)
```

## What reading a value does

A read is the whole subscription. There is no mount hook to put the load in, and no
`load()` to call — reading is what starts the work, and reading again is what keeps you
subscribed to it.

| The value is | A read gives you |
| --- | --- |
| settled | the value |
| still in flight | `undefined`, and a sink opens where it was read |
| failed | it throws, to the nearest `{#try}` or to `error.abide` |

The middle row is the one that decides how pages here are written. **A read never
awaits.** The document goes out with holes in it and the holes fill when the values
land, so the ordinary page has no loading branch in it at all. Waiting is the opt-in,
spelled `{await value}`.

`peek` reads without joining the flow — the same value, no subscription.

Read on: [Local state](show-a-value-that-changes.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## Probes: `pending`, `refreshing`, `done`

Probes answer that without reading the value. **A probe never throws and never starts
work**, so it is safe in a branch that runs before anything has arrived.

| Probe | True when |
| --- | --- |
| `pending()` | a first load, with nothing to show yet |
| `refreshing()` | a reload in flight over a value still being served |
| `done()` | it finished, however it finished |
| `success()` | it landed, it did not fail, and nothing is still arriving |

Reading a probe subscribes you to **that probe alone**. A value changing does not wake
a `refreshing()` reader, which is why a spinner does not re-render a table.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md)

## When a memo runs again

A `memo` re-runs when what its body read changes — that is the whole dependency graph,
and you never register anything. It is also identity per arguments, so two components
asking for invoice `42` are one load and the second gets what the first is waiting on.

Ask for it fresh with `invalidate`, which marks it stale so the next read fetches
rather than serving what is held.

Read on: [Derived values](derive-a-value-from-other-values.md) ·
[Caching](load-once-per-set-of-arguments.md) ·
[Reloading](decide-when-a-value-reloads.md) ·
[Throttle & debounce](slow-down-a-value-that-changes-too-fast.md)

## Values with no owner

A room is the third kind. A state is written by whoever owns it and a memo is computed by its
body; a room is written by **anything that can reach it**, and read the same way. So a bare read
is the latest message, `pending()` runs until the first one, and `tail` counts messages.

Read on: [Rooms](let-anything-publish-and-anything-read.md)

## Reading one value from two components

The same value in two places is declared once, not a prop threaded through every
level between them.

Read on: [Sharing](share-one-value-across-components.md)

## Running code when a value changes

`watch` runs an effect when its sources change and hands back a disposer, so the
cleanup is the return value rather than a second argument you might forget.

Read on: [Watching values](do-something-when-a-value-changes.md)

## Keeping more than the latest value

`tail` decides how many past productions a later reader can still replay — a log pane,
a chat scrollback, the last n readings. It defaults to 1, so retention is asked for.

Read on: [History & tail](keep-the-last-few-values.md)
