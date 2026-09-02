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

## Local state

{% lead values/show-a-value-that-changes %}

Read on: [Local state](show-a-value-that-changes.md)

## Derived values

{% lead values/derive-a-value-from-other-values %}

Read on: [Derived values](derive-a-value-from-other-values.md)

## Rooms

{% lead values/let-anything-publish-and-anything-read %}

Read on: [Rooms](let-anything-publish-and-anything-read.md)

## Loading states

{% lead values/show-a-value-that-isnt-there-yet %}

Read on: [Loading states](show-a-value-that-isnt-there-yet.md)

## Caching

{% lead values/load-once-per-set-of-arguments %}

Read on: [Caching](load-once-per-set-of-arguments.md)

## Reloading

{% lead values/decide-when-a-value-reloads %}

Read on: [Reloading](decide-when-a-value-reloads.md)

## Throttle & debounce

{% lead values/slow-down-a-value-that-changes-too-fast %}

Read on: [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md)

## Sharing

{% lead values/share-one-value-across-components %}

Read on: [Sharing](share-one-value-across-components.md)

## Watching values

{% lead values/do-something-when-a-value-changes %}

Read on: [Watching values](do-something-when-a-value-changes.md)

## History & tail

{% lead values/keep-the-last-few-values %}

Read on: [History & tail](keep-the-last-few-values.md)
