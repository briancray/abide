---
title: Reactive values
nav: Overview
intent: One factory, four ways to use it, and the one type all four hand back.
---

One factory, `reactive`, and four ways to use it. **One type back** — every one of them is a
`Reactive`, so a member learned on one is a member on all four.

| You write | The value comes from | What reloads it |
| --- | --- | --- |
| `reactive(0)` | you | nothing — you write it yourself |
| `reactive(() => a + b)` | other values | a value its body read, moving |
| `reactive(() => getThing({ id }))` | your server | `refresh`, `invalidate`, a tag, a `ttl` |
| `reactive<Message>(undefined, { history })` | the system, live | whoever publishes |

**The arrow makes the third row reloadable.** `reactive(getThing({ id }))` compiles and loads
once, and then every trigger on it does nothing: a value handed in has no producer to re-run, so
`refresh` and a tag alike are inert on it. Where you want one known thing, loaded once and reloaded
when you say, hand `reactive` an arrow rather than the call.

```ts shared
const draft = reactive('')
const words = reactive(() => draft().split(' ').length)
```

## Local state

{% lead values/show-a-value-that-changes %}

Read on: [Local state](show-a-value-that-changes.md)

## Derived values

{% lead values/derive-a-value-from-other-values %}

Read on: [Derived values](derive-a-value-from-other-values.md)

## Channels

{% lead values/let-anything-publish-and-anything-read %}

Read on: [Channels](let-anything-publish-and-anything-read.md)

## Patching a list

{% lead values/patch-a-list-from-a-live-feed %}

Read on: [Patching a list](patch-a-list-from-a-live-feed.md)

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

## History

{% lead values/keep-the-last-few-values %}

Read on: [History](keep-the-last-few-values.md)

## Persistence

{% lead values/keep-a-value-outside-the-process %}

Read on: [Persistence](keep-a-value-outside-the-process.md)
