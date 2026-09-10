---
title: state()
nav: state
intent: The factory for a value a scope owns, and the one way to share one by key.
enumerates:
  - state
---

The **`state()`** function creates a [`Reactive`](reactive.md) holding a value the current
scope owns. It takes what it will accept for the rest of its life: a settled value, or a load.

## Syntax

```ts browser
state()
state(initial)
state(initial, options)
```

### Parameters

* `initial` (optional) — the value the state starts with, settled or a `Promise`. Given a
  promise, the state is loaded: `pending()` is true until it settles, and the state serves the
  settled value rather than the promise. Omitted, the result is a `Reactive<undefined>` that
  has already settled.
* `options` (optional) — the [`Reactive`](reactive.md) options, all of them optional.

### Return value

A `Reactive<Stored, Accepted, Failures>`. `Stored` is `Accepted` unless a `transform` was given.

### Exceptions

`state()` does not throw. A `schema` that refuses a write does not throw out of `set()`
either: the refusal is caught, converted, and returned as a `Failed` that fills `error()`.

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `state` | `<Accepted, Stored = Accepted, Failures = never>(initial: Accepted \| Promise<Accepted>, options?: ReactiveOptions<Accepted, Stored, Failures>) => Reactive<Stored, Accepted, Failures>` | The factory. |
| `state.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the component's scope by key. One call rather than a share/read pair, so there is no ordering hazard and no miss to define. |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. A key it declares is checked against it; one it does not is inferred from the thunk. |

## Description

A state has no producer unless it was given one, and a promise or a `store` gives it one.
Without a producer `refresh()` and `invalidate()` do nothing and `ttl` is inert, which keeps
either from discarding a value only the app can supply.

`state.share` is scoped to the component instance and its descendants. A key an ancestor holds
is the one you get; a key nothing above you holds is created where you asked for it. A shared
value is never evicted within its scope; it goes when the scope does.

The key must be a literal, which is read off the syntax, so the key set is bounded by what the
source spells.

## Examples

### A value the page owns

```abide abide
<script>
import { state } from 'abide'

const handle = state('ada')
</script>

<h1>{handle}</h1>
<input bind:value={handle}>
```

### A value normalised on the way in

```ts shared
export const handle = state('', {
    transform: (value) => value.trim().toLowerCase().replaceAll(' ', '_'),
})
```

### A value the server supplies

```ts shared
export const profile = state(getProfile())
```

The type is `Reactive<User>`, never `Reactive<Promise<User>>`.

## See also

* [Local state](../values/show-a-value-that-changes.md)
* [Sharing](../values/share-one-value-across-components.md)
* [Persistence](../values/keep-a-value-outside-the-process.md)
* [`Reactive`](reactive.md)
