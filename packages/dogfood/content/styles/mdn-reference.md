---
title: state() (MDN reference)
nav: MDN reference
intent: The local-state guide as a web platform reference entry — syntax, parameters, return value, examples.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — MDN reference.** Web platform documentation. A fixed section order that every page
> repeats, so a reader who has read one page can navigate all of them. The prose describes the
> interface rather than a use case, and the reader is assumed to know which name they came for.

The `state()` function creates a `Reactive` that holds a value owned by the scope it is
declared in. The value is read by calling the returned object, written through `set()`, and any
template expression that read it is re-evaluated when it is written.

## Syntax

```ts browser
state()
state(initial)
state(initial, options)
```

### Parameters

* `initial` (optional) — the value the state starts with. May be a settled value or a `Promise`.
  Given a `Promise`, the state is **loaded** rather than owned: `pending()` is `true` until it
  settles, and the state serves the settled value rather than the promise. If omitted, the state
  is a `Reactive<undefined>` that has already settled.
* `options` (optional) — an object carrying the properties below, all of them optional.

The properties of `options`:

* `options.schema` — a `Schema<Accepted>` checked on the way in, before `transform`. Refuses by
  throwing; the throw is caught and converted into `Failed<'ValidationError', Issues<Accepted>>`.
* `options.transform` — a `Transformer` run on the settled value to produce what is stored.
* `options.store` — a `{ get, set }` pair naming where the value lives outside the process.
* `options.identity` — how a write is compared against the held value to decide whether it is a
  production.
* `options.ttl` — milliseconds after which a value with a producer is considered stale.

### Return value

A `Reactive<Stored, Accepted, Failures>`.

`Stored` is `Accepted` unless a `transform` was given, in which case it is that transform's return
type. `Failures` is `never` unless a `schema` or a refusing `transform` contributed to it.

### Exceptions

`state()` itself does not throw. A `schema` that refuses a write does not throw out of `set()`
either: the refusal is caught, converted, and returned from `set()` as a `Failed`. It fills
`error()` rather than reaching a `{:catch}` block.

## Description

`state()` is one of several `Reactive` factories — `memo()`, `channel()` and every rpc handler
return the same type — so the probes, `await` and `tail` documented on `Reactive` are all
available on a value that a page merely owns.

### Type parameters

Two types describe a state, and they come apart only when a `transform` is given:

* `Accepted` — what `state()` and `set()` take, before `schema` and `transform` run.
* `Stored` — what is held, and what a read returns.

Without a `transform`, `Stored` is `Accepted`, so `state<number>(0)` is the single type parameter
it appears to be. A `schema` never moves the two apart, because it returns what it stores.

### Reading and writing

The interface is two members: `s()` reads, `s.set(v)` writes.

```ts browser
const handle = state('')

handle()            // ''
handle.set('ada')
handle()            // 'ada'
```

Inside a `.abide` file the same two members are reachable by name, and the explicit spelling above
continues to compile unchanged:

{% snippet local-state src/ui/pages/profile/page.abide <h1> … <input bind:value %}

`handle` in an expression is the read. `handle = 'ada'` is the write. `bind:value={handle}` is
both. Naming the state without using it in an expression passes the `Reactive` itself.

### Transformation

A `transform` runs untracked, on the settled value, once per materialisation of a stored value —
per write on a state, and never on the promise. It may also refuse the write by returning a
`Failed`, in which case nothing is stored.

A `schema` and a `transform` are both gates on the way in, and they differ in what they refuse
*with*. A `schema` refuses as `ValidationError` carrying the validation issues. A `transform`
refuses under a name the application declared, which is the only way a refusal arrives with data
of its own.

## Examples

### Basic usage

{% snippet local-state src/shared/profile.ts export function save %}

### Normalising a value on the way in

{% snippet local-state src/shared/profile.ts export const handle %}

`Accepted` here is `string` and `Stored` is `string`, but the stored value is never the one that
was typed.

### Loading a state from the server

{% snippet local-state src/shared/profile.ts export const profile %}

The resulting type is `Reactive<User>`, not `Reactive<Promise<User>>`. Until the promise settles,
`profile.pending()` is `true` and any template expression reading it renders its pending branch.

### A complete page

{% example local-state %}

## Usage notes

* A state constructed from a settled value has **no producer**. `refresh()` and `invalidate()` do
  nothing on it, and `ttl` is inert rather than destructive — neither will discard a value that
  only the application can supply.
* A state constructed from a `Promise`, or given a `store`, does have a producer, and those same
  triggers become meaningful.
* `state()` with no argument reports `success()` immediately. An owned value is not something that
  loads, so it never sits in a condition that no `{#await}` branch would mount for.

## Specifications

`state`, `Accepted`, `Stored` and `Transformer` are specified in
[Reactive](../reference/reactive.md).

## See also

* [`memo`](../values/derive-a-value-from-other-values.md)
* [`channel`](../values/let-anything-publish-and-anything-read.md)
* [Values by name](../templates/read-and-write-a-value-by-name.md)
* [`bind:`](../templates/bind-a-form-to-state.md)
