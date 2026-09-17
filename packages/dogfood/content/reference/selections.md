---
title: Selections
nav: Selections
intent: The four free functions that ask about many entries at once.
enumerates:
  - Selections — over many entries
---

A probe answers about one [`Reactive`](reactive.md); a **selection** answers about a set of
them. The four below are free functions, and the members on a value are defined as them —
`s.refresh()` is `refresh(s)`, and `k.refresh(pattern)` is `refresh(k)` narrowed by args.

## Syntax

```ts browser
busy(selection)
ready(selection)
refresh(selection)
invalidate(selection)
```

Called bare, each one means the whole scope.

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Keyed<any, any, any, any> \| { tags: string[] }` | One value, one keyed value — every args key of it — or every entry carrying any of these tags, across values. |
| `busy` | `(selection?: Selection) => boolean` | Whether any entry in the selection has work in flight. |
| `ready` | `(selection?: Selection) => boolean` | Whether every entry in the selection has a value to serve. |
| `refresh` | `(selection?: Selection) => void` | Stale while revalidate, over the selection. |
| `invalidate` | `(selection?: Selection) => void` | Marks the selection stale. Nothing loads and nobody is woken until the next read. |

## Description

**Any for `busy`, all for `ready`.** These are the quantifiers under which `busy() && !ready()`
reads as one sentence: anything is loading, and there is not yet everything to show. An
aggregate `error()` would have to decide which failure to hand back, so there is no free form
of it.

One signal is held per selection, never one per entry, so a page-level spinner over n entries
reloading together wakes twice rather than 2n times.

**An explicit argument reaches anything; a bare sweep reaches producers.** Passing a `Reactive`
is a deliberate act about that one value, but a bare `invalidate()` matches only entries that
have a producer — catching a `reactive(0)` would be silent data loss.

`invalidate` is lazy and `refresh` is eager, and at this width the eager one is bounded by what
is subscribed. An `invalidate()` over two hundred entries drops two hundred caches and loads
none, where a `refresh()` reloads only what something is reading and marks the rest. That makes
`refresh()` the reconnect default.

A selection is scope-bounded as a value is, and a tag with it, so one request can never
invalidate another's. The `global` entries are the exception on a server: a bare `invalidate()`
and a bare `refresh()` each reach every one of them in the process, that being the whole of what
a bare sweep can still touch once the request's own entries die with it.

## Examples

### A page-level activity indicator

```abide abide
{#if busy()}<Spinner/>{/if}
```

### Everything about one row, across values

```ts server
invalidate({ tags: [`customer:${id}`] })
```

### Catching up after a reconnect

```ts browser
watch(() => {
    if (online()) refresh()
})
```

## See also

* [Reloading](../values/decide-when-a-value-reloads.md)
* [Caching](../values/load-once-per-set-of-arguments.md)
* [`reactive`](reactive.md)
