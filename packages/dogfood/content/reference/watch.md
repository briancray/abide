---
title: watch()
nav: watch
intent: The effect — run something on change, and tear the last run down.
enumerates:
  - watch
---

The **`watch()`** function runs an effect immediately and again whenever a reactive value it
read changes. It hands back the way to stop it.

## Syntax

```ts browser
watch(effect)
watch(sources, effect)
```

### Parameters

* `sources` (optional) — one `Reactive` or an array of them. Given, the effect runs only when
  those change. Two overloads rather than a union: the first argument discriminates them.
* `effect` — the function to run. Returning a `Disposer` gives it a teardown.

### Return value

A function that stops the watch.

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `watch` | `(effect: Effect) => () => void` | Watches whatever the effect reads. |
| `watch` | `<Stored>(sources: Reactive<Stored> \| Reactive<Stored>[], effect: Effect) => () => void` | The narrowed form, over named sources. |
| `Effect` | `() => void \| Disposer` | What runs on change. |
| `Disposer` | `() => void` | What tears down the previous run: before each rerun, and once at teardown. |

## Description

A watch registered inside a component is owned by it, and its disposer runs at unmount. One
registered from a plain `.ts` module has no owner, which is what the returned function is for.

**On a server a watch runs once.** There is no rerender, so a tracked read registers no
subscriber and nothing wakes it a second time; the disposer still runs at scope teardown. That
is isomorphism of intent rather than of schedule.

An error in an effect is never silent. A throw from the effect, a throw from the disposer, and
a read of a failed value inside one all reach `onError` with the trace attached and warn on
`abide:watch`. In a browser it is additionally re-thrown as an unhandled rejection so an error
reporter sees it.

**An effect that threw stops its watch.** One that throws once usually throws every run, and a
watch re-running into the same throw is a loop with a log line per iteration.

## Examples

### An effect over what it reads

```ts browser
const stop = watch(() => {
    document.title = `${unread()} unread`
})
```

### An effect with a teardown

```ts browser
watch(() => {
    const id = setInterval(poll, 1000)
    return () => clearInterval(id)
})
```

### An effect narrowed to its sources

```ts browser
watch([topic], () => analytics.compose(topic(), draft().length))
```

## See also

* [Watching values](../values/do-something-when-a-value-changes.md)
* [Scripts](../templates/run-code-when-a-component-loads.md)
* [`Reactive`](reactive.md)
